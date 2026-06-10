import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const HISTORY_KEY = 'temp_mail_history_v2';

function randomPrefix() {
  return Math.random().toString(36).slice(2, 8);
}

function normalizePrefix(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32);
}

export function useMailbox() {
  const domain = ref('example.com');
  const pollIntervalMs = ref(15000);
  const prefix = ref('');
  const emails = ref([]);
  const history = ref([]);
  const loading = ref(false);
  const error = ref('');
  const autoRefresh = ref(true);
  const lastUpdatedAt = ref('');
  const activeEmailId = ref(null);
  const activeTab = ref('rendered');
  let pollingTimer = null;

  const fullAddress = computed(() => `${prefix.value}@${domain.value}`.toLowerCase());
  const activeEmail = computed(() => emails.value.find((email) => email.id === activeEmailId.value) || null);

  function loadHistory() {
    try {
      const storedValue = localStorage.getItem(HISTORY_KEY);
      history.value = storedValue ? JSON.parse(storedValue) : [];
    } catch (_error) {
      history.value = [];
    }
  }

  function persistHistory(nextPrefix) {
    if (!nextPrefix) {
      return;
    }

    const nextHistory = [nextPrefix, ...history.value.filter((item) => item !== nextPrefix)].slice(0, 10);
    history.value = nextHistory;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
  }

  function clearHistory() {
    history.value = [];
    localStorage.removeItem(HISTORY_KEY);
  }

  function setActiveEmail(id) {
    activeEmailId.value = id;
    activeTab.value = 'rendered';
  }

  async function fetchConfig() {
    const response = await fetch('/api/config');
    const data = await response.json();
    domain.value = data.domain || domain.value;
    pollIntervalMs.value = data.pollIntervalMs || pollIntervalMs.value;
  }

  async function fetchEmails({ silent = false } = {}) {
    if (!prefix.value) {
      return;
    }

    if (!silent) {
      loading.value = true;
    }

    error.value = '';

    try {
      const response = await fetch(`/api/emails?address=${encodeURIComponent(fullAddress.value)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '获取邮件失败');
      }

      emails.value = data;
      if (!activeEmailId.value && data.length > 0) {
        activeEmailId.value = data[0].id;
      }
      if (activeEmailId.value && !data.some((item) => item.id === activeEmailId.value)) {
        activeEmailId.value = data[0]?.id || null;
      }
      lastUpdatedAt.value = new Date().toLocaleTimeString();
    } catch (requestError) {
      error.value = requestError.message || '获取邮件失败';
    } finally {
      loading.value = false;
    }
  }

  async function deleteEmail(id) {
    const response = await fetch(`/api/emails?id=${encodeURIComponent(id)}&address=${encodeURIComponent(fullAddress.value)}`, {
      method: 'DELETE'
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '删除失败');
    }

    emails.value = emails.value.filter((email) => email.id !== id);
    if (activeEmailId.value === id) {
      activeEmailId.value = emails.value[0]?.id || null;
    }
  }

  function refreshNow() {
    prefix.value = normalizePrefix(prefix.value);
    persistHistory(prefix.value);
    return fetchEmails();
  }

  function usePrefix(nextPrefix) {
    prefix.value = normalizePrefix(nextPrefix);
  }

  function generateRandomPrefix() {
    prefix.value = randomPrefix();
    persistHistory(prefix.value);
    return fetchEmails();
  }

  function startPolling() {
    stopPolling();
    pollingTimer = window.setInterval(() => {
      if (autoRefresh.value && !document.hidden) {
        fetchEmails({ silent: true });
      }
    }, pollIntervalMs.value);
  }

  function stopPolling() {
    if (pollingTimer) {
      window.clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  watch([autoRefresh, pollIntervalMs], () => {
    startPolling();
  });

  onMounted(async () => {
    loadHistory();
    await fetchConfig();
    prefix.value = history.value[0] || randomPrefix();
    persistHistory(prefix.value);
    await fetchEmails();
    startPolling();
  });

  onBeforeUnmount(() => {
    stopPolling();
  });

  return {
    activeEmail,
    activeEmailId,
    activeTab,
    autoRefresh,
    clearHistory,
    deleteEmail,
    domain,
    emails,
    error,
    fetchEmails,
    fullAddress,
    generateRandomPrefix,
    history,
    lastUpdatedAt,
    loading,
    prefix,
    refreshNow,
    setActiveEmail,
    usePrefix
  };
}
