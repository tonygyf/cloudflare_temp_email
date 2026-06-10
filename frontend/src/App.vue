<script setup>
import { computed, ref } from 'vue';
import { useMailbox } from './composables/useMailbox.js';

const copyState = ref({});

const {
  activeEmail,
  activeEmailId,
  activeTab,
  autoRefresh,
  clearHistory,
  deleteEmail,
  domain,
  emails,
  error,
  fullAddress,
  generateRandomPrefix,
  history,
  lastUpdatedAt,
  loading,
  prefix,
  refreshNow,
  setActiveEmail
} = useMailbox();

const renderedHtml = computed(() => activeEmail.value?.html || '');
const renderedText = computed(() => activeEmail.value?.text || '当前邮件没有可展示的纯文本正文。');
const selectedMeta = computed(() => {
  if (!activeEmail.value) {
    return [];
  }

  return [
    ['发件人', activeEmail.value.from],
    ['接收时间', new Date(activeEmail.value.created_at).toLocaleString()],
    ['附件数', String(activeEmail.value.attachmentCount || 0)],
    ['原文编码', activeEmail.value.raw_email_encoding]
  ];
});

async function copyToClipboard(text, key) {
  try {
    await navigator.clipboard.writeText(text);
    copyState.value[key] = '已复制';
    window.setTimeout(() => {
      delete copyState.value[key];
    }, 1800);
  } catch (_error) {
    copyState.value[key] = '复制失败';
  }
}

async function handleDeleteEmail(id) {
  if (!window.confirm('确定删除这封邮件吗？')) {
    return;
  }

  try {
    await deleteEmail(id);
  } catch (deleteError) {
    window.alert(deleteError.message || '删除失败');
  }
}

async function applyCurrentPrefix() {
  await refreshNow();
}

async function handleGenerateRandom() {
  await generateRandomPrefix();
}
</script>

<template>
  <div class="layout-shell">
    <section class="hero-card">
      <div>
        <p class="eyebrow">Cloudflare Temp Mail</p>
        <h1>收件解析稳定版</h1>
        <p class="hero-copy">
          前端和 Worker 已拆分，邮件正文改为服务端统一解析，避免浏览器侧解析导致的乱码和不稳定。
        </p>
      </div>
      <div class="hero-stats">
        <article class="stat-card">
          <span class="stat-label">当前域名</span>
          <strong>{{ domain }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">最近刷新</span>
          <strong>{{ lastUpdatedAt || '尚未刷新' }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">邮件数量</span>
          <strong>{{ emails.length }}</strong>
        </article>
      </div>
    </section>

    <section class="control-card">
      <div class="control-heading">
        <div>
          <h2>邮箱地址</h2>
          <p>输入前缀即可生成专属临时邮箱，刷新后会自动拉取最新收件。</p>
        </div>
        <button class="ghost-button" @click="copyToClipboard(fullAddress, 'address')">
          {{ copyState.address || '复制地址' }}
        </button>
      </div>

      <div class="address-builder">
        <label class="address-input">
          <span class="address-prefix">@</span>
          <input
            v-model.trim="prefix"
            type="text"
            maxlength="32"
            placeholder="例如 github-login"
            @keyup.enter="applyCurrentPrefix"
          />
        </label>
        <div class="domain-pill">{{ domain }}</div>
      </div>

      <div class="toolbar-row">
        <button class="primary-button" :disabled="loading" @click="applyCurrentPrefix">
          {{ loading ? '刷新中...' : '刷新收件箱' }}
        </button>
        <button class="secondary-button" @click="handleGenerateRandom">随机邮箱</button>
        <label class="toggle-pill">
          <input v-model="autoRefresh" type="checkbox" />
          <span>自动刷新</span>
        </label>
      </div>

      <div class="full-address">
        <span>完整地址</span>
        <strong>{{ fullAddress }}</strong>
      </div>

      <div v-if="history.length" class="history-block">
        <div class="history-header">
          <span>最近使用</span>
          <button class="text-button" @click="clearHistory">清空</button>
        </div>
        <div class="history-list">
          <button
            v-for="item in history"
            :key="item"
            class="history-chip"
            :class="{ active: item === prefix }"
            @click="prefix = item; applyCurrentPrefix()"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error-banner">{{ error }}</p>
    </section>

    <section class="content-grid">
      <aside class="panel inbox-panel">
        <div class="panel-header">
          <h2>收件箱</h2>
          <span>{{ emails.length }} 封</span>
        </div>

        <div v-if="loading && !emails.length" class="empty-state">正在获取邮件...</div>
        <div v-else-if="!emails.length" class="empty-state">暂时还没有新邮件，保持自动刷新即可等待。</div>

        <button
          v-for="email in emails"
          :key="email.id"
          class="mail-card"
          :class="{ active: email.id === activeEmailId }"
          @click="setActiveEmail(email.id)"
        >
          <div class="mail-card-header">
            <strong>{{ email.subject || '无主题' }}</strong>
            <span>{{ new Date(email.created_at).toLocaleTimeString() }}</span>
          </div>
          <p class="mail-from">{{ email.from }}</p>
          <p class="mail-preview">{{ email.preview || '这封邮件没有可预览的正文内容。' }}</p>
          <div class="mail-card-footer">
            <span v-if="email.verificationCode" class="code-badge">验证码 {{ email.verificationCode }}</span>
            <span v-else class="muted-badge">无验证码</span>
            <span class="muted-badge">附件 {{ email.attachmentCount || 0 }}</span>
          </div>
        </button>
      </aside>

      <article class="panel detail-panel">
        <div v-if="!activeEmail" class="empty-state large">
          选择左侧邮件后即可查看正文、验证码和原始 EML。
        </div>

        <template v-else>
          <div class="panel-header detail-header">
            <div>
              <h2>{{ activeEmail.subject || '无主题' }}</h2>
              <p>{{ activeEmail.from }}</p>
            </div>
            <div class="detail-actions">
              <button class="ghost-button" @click="copyToClipboard(activeEmail.raw_email, `raw_${activeEmail.id}`)">
                {{ copyState[`raw_${activeEmail.id}`] || '复制原文' }}
              </button>
              <button
                v-if="activeEmail.verificationCode"
                class="secondary-button"
                @click="copyToClipboard(activeEmail.verificationCode, `code_${activeEmail.id}`)"
              >
                {{ copyState[`code_${activeEmail.id}`] || `复制验证码 ${activeEmail.verificationCode}` }}
              </button>
              <button class="danger-button" @click="handleDeleteEmail(activeEmail.id)">删除邮件</button>
            </div>
          </div>

          <div class="meta-grid">
            <div v-for="[label, value] in selectedMeta" :key="label" class="meta-item">
              <span>{{ label }}</span>
              <strong>{{ value }}</strong>
            </div>
          </div>

          <div v-if="activeEmail.verificationCode" class="code-panel">
            <span>提取到验证码</span>
            <strong>{{ activeEmail.verificationCode }}</strong>
          </div>

          <div class="tab-row">
            <button
              class="tab-button"
              :class="{ active: activeTab === 'rendered' }"
              @click="activeTab = 'rendered'"
            >
              渲染正文
            </button>
            <button
              class="tab-button"
              :class="{ active: activeTab === 'text' }"
              @click="activeTab = 'text'"
            >
              纯文本
            </button>
            <button
              class="tab-button"
              :class="{ active: activeTab === 'raw' }"
              @click="activeTab = 'raw'"
            >
              原始 EML
            </button>
          </div>

          <div v-if="activeTab === 'rendered'" class="reader-frame">
            <iframe
              v-if="renderedHtml"
              :srcdoc="renderedHtml"
              title="邮件 HTML 正文"
              sandbox="allow-popups allow-same-origin"
            />
            <pre v-else class="reader-text">{{ renderedText }}</pre>
          </div>

          <pre v-else-if="activeTab === 'text'" class="reader-text">{{ renderedText }}</pre>
          <pre v-else class="reader-text raw-text">{{ activeEmail.raw_email }}</pre>
        </template>
      </article>
    </section>
  </div>
</template>
