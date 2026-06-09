export default {
  // 处理接收到的邮件 (Cloudflare Email Routing 触发)
  async email(message, env, ctx) {
    try {
      // 无论发件人发给哪个子域名，我们都统一将后缀替换为环境变量中的 DOMAIN
      // 例如：发给 test@mail.gyf123.dpdns.org，存入数据库时会变成 test@gyf123.dpdns.org
      let address = message.to.toLowerCase();
      const prefix = address.split('@')[0];
      const targetDomain = (env.DOMAIN || 'gyf123.dpdns.org').toLowerCase();
      address = `${prefix}@${targetDomain}`;
      
      // 读取邮件的原始文本流
      // 注意：根据 Cloudflare 文档，message.raw 是一个 ReadableStream
      const rawEmail = await new Response(message.raw).text();
      
      // 存入 D1 数据库
      await env.DB.prepare(
        "INSERT INTO emails (address, raw_email) VALUES (?, ?)"
      ).bind(address, rawEmail).run();
    } catch (error) {
      console.error("Failed to process email:", error);
    }
  },

  // 处理 HTTP 请求 (前端页面和 API)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // API: 获取某个邮箱地址的邮件列表 (供前端和外部项目使用)
    if (request.method === 'GET' && url.pathname === '/api/emails') {
      const address = (url.searchParams.get('address') || '').toLowerCase().trim();
      if (!address) {
        return new Response(JSON.stringify({ error: 'Missing address parameter' }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      
      try {
        // 提取前缀，比如从 test@gyf123.dpdns.org 提取出 test
        const prefix = address.split('@')[0];
        
        // 打印日志，方便在 Cloudflare 控制台查看
        console.log(`Fetching emails for prefix: ${prefix}`);
        
        // 使用 LIKE 模糊匹配，匹配任何以 test@ 开头的地址
        const { results } = await env.DB.prepare(
          "SELECT id, created_at, raw_email FROM emails WHERE address LIKE ? ORDER BY id DESC LIMIT 50"
        ).bind(`${prefix}@%`).all();
        
        console.log(`Found ${results.length} emails for ${prefix}`);
        
        // 如果是外部项目调用，我们可以在后端做一些简单的正则提取，方便外部直接使用
        // 注意：完整的解析还是在前端做比较好，这里只做简单的文本提取
        const formattedResults = results.map(row => {
          const raw = row.raw_email || '';
          // 简单提取发件人和主题 (从 header 中)
          const fromMatch = raw.match(/^From:\s*(.+)$/im);
          const subjectMatch = raw.match(/^Subject:\s*(.+)$/im);
          
          // 简单提取验证码 (移除 HTML 标签后匹配)
          const cleanText = raw.replace(/<[^>]*>?/gm, ' ');
          const codeMatch = cleanText.match(/(?:验证码|code|Code|CODE|passcode|token|pin)[\s:：]*([a-zA-Z0-9]{4,8})\b/i) 
                         || cleanText.match(/\b(\d{4,8})\b/);
                         
          return {
            id: row.id,
            created_at: row.created_at,
            from: fromMatch ? fromMatch[1].trim() : 'Unknown',
            subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
            verificationCode: codeMatch ? codeMatch[1] : null,
            raw_email: row.raw_email // 保留原文供前端 postal-mime 深度解析
          };
        });
        
        return new Response(JSON.stringify(formattedResults), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*' // 允许跨域，方便你的其他项目调用
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // API: 删除某封邮件
    if (request.method === 'DELETE' && url.pathname === '/api/emails') {
      const id = url.searchParams.get('id');
      const address = (url.searchParams.get('address') || '').toLowerCase().trim();
      if (!id || !address) {
        return new Response('Missing parameters', { status: 400 });
      }
      
      try {
        const prefix = address.split('@')[0];
        await env.DB.prepare(
          "DELETE FROM emails WHERE id = ? AND address LIKE ?"
        ).bind(id, `${prefix}@%`).run();
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
    }

    // 前端: 返回极简的 HTML 页面
    if (url.pathname === '/') {
      const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>极简临时邮箱</title>
  <!-- 替换 Tailwind CDN 为生产环境可用的预编译 CSS -->
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <!-- 引入一个极其稳定且支持浏览器直接使用的邮件解析库 letterparser -->
  <script src="https://cdn.jsdelivr.net/npm/letterparser@2.0.1/lib/letterparser.min.js"></script>
  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
</head>
<body class="bg-gray-100 p-4 md:p-8">
  <div id="app" class="max-w-4xl mx-auto">
    <h1 class="text-3xl font-bold mb-6 text-center text-gray-800">极简临时邮箱</h1>
    
    <!-- 邮箱地址控制区 -->
    <div class="bg-white p-6 rounded-lg shadow-md mb-6">
      <div class="flex flex-col md:flex-row gap-4 items-center">
        <div class="flex flex-1 w-full items-center border rounded overflow-hidden">
          <input v-model="prefix" @change="handlePrefixChange" placeholder="输入自定义前缀" class="flex-1 p-3 outline-none font-mono">
          <span class="bg-gray-50 p-3 text-gray-600 border-l font-mono">@{{ domain }}</span>
        </div>
        <div class="flex gap-2 w-full md:w-auto">
          <button @click="generateRandom" class="flex-1 md:flex-none bg-gray-200 text-gray-700 px-4 py-3 rounded hover:bg-gray-300 transition font-medium">
            🎲 随机
          </button>
          <button @click="fetchEmails" class="flex-1 md:flex-none bg-blue-500 text-white px-6 py-3 rounded hover:bg-blue-600 transition font-medium">
            刷新收件箱
          </button>
        </div>
      </div>
      <div class="flex items-center justify-center md:justify-start gap-2 mt-3">
        <p class="text-sm text-gray-500">
          你的完整邮箱地址: <span class="font-mono font-bold text-gray-800">{{ fullAddress }}</span>
        </p>
        <button @click="copyToClipboard(fullAddress, 'address')" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-1 rounded transition">
          {{ copyStatus['address'] || '复制' }}
        </button>
      </div>

      <!-- 历史记录区 -->
      <div v-if="history.length > 0" class="mt-5 pt-4 border-t">
        <p class="text-sm text-gray-500 mb-2">最近使用的邮箱 (保存在本地):</p>
        <div class="flex flex-wrap gap-2 items-center">
          <button v-for="h in history" :key="h" @click="selectHistory(h)" 
                  class="px-3 py-1.5 text-sm bg-gray-50 hover:bg-gray-200 rounded-md border transition font-mono"
                  :class="{'bg-blue-50 border-blue-300 text-blue-700': prefix === h}">
            {{ h }}
          </button>
          <button @click="clearHistory" class="px-2 py-1 text-xs text-red-400 hover:text-red-600 transition ml-auto">
            清空历史
          </button>
        </div>
      </div>
    </div>

    <!-- 邮件列表区 -->
    <div class="space-y-4">
      <div v-if="loading" class="text-center text-gray-500 py-8">正在获取邮件...</div>
      <div v-else-if="emails.length === 0" class="text-center text-gray-500 py-8 bg-white rounded-lg shadow-sm">
        收件箱为空，等待邮件到达...
      </div>
      
      <div v-for="email in emails" :key="email.id" class="bg-white p-6 rounded-lg shadow-md overflow-hidden relative group">
        <div class="flex flex-col md:flex-row justify-between border-b pb-3 mb-4 gap-2">
          <div class="pr-8">
            <p class="font-bold text-lg text-gray-800">{{ email.parsed?.subject || email.subject || '无主题' }}</p>
            <p class="text-sm text-gray-600 mt-1">发件人: <span class="font-mono">{{ email.parsed?.from?.address || email.from || '未知' }}</span></p>
          </div>
          <div class="text-sm text-gray-500 md:text-right flex flex-col items-end justify-between">
            <span>{{ new Date(email.created_at).toLocaleString() }}</span>
            <div class="flex gap-3 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button @click="email.showRaw = !email.showRaw" class="text-gray-500 hover:text-gray-700 transition-colors">
                📄 {{ email.showRaw ? '隐藏原文' : '查看原文' }}
              </button>
              <button @click="deleteEmail(email.id)" class="text-red-500 hover:text-red-700 transition-colors">
                🗑️ 删除
              </button>
            </div>
          </div>
        </div>

        <!-- 智能提取验证码 -->
        <div v-if="email.verificationCode" class="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between">
          <div>
            <span class="text-blue-800 font-bold text-sm">提取到的验证码：</span>
            <span class="text-2xl font-mono text-blue-600 ml-2 tracking-widest">{{ email.verificationCode }}</span>
          </div>
          <button @click="copyToClipboard(email.verificationCode, 'code_' + email.id)" class="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded transition">
            {{ copyStatus['code_' + email.id] || '复制' }}
          </button>
        </div>

        <!-- 邮件内容展示 -->
        <div v-show="!email.showRaw" class="prose max-w-none overflow-x-auto">
          <iframe v-if="email.parsed?.html" :srcdoc="email.parsed.html" class="w-full min-h-[300px] border-0" sandbox="allow-same-origin allow-popups"></iframe>
          <pre v-else-if="email.parsed?.text" class="whitespace-pre-wrap font-sans text-gray-700">{{ email.parsed.text }}</pre>
          <div v-else class="text-gray-400 italic">正在解析邮件内容...</div>
        </div>

        <!-- 邮件原文展示 (EML) -->
        <div v-show="email.showRaw" class="mt-2 p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto text-xs font-mono leading-relaxed">
          <div class="flex justify-between mb-2 border-b border-gray-700 pb-2">
            <span class="text-gray-400">原始邮件数据 (EML)</span>
            <button @click="copyToClipboard(email.raw_email, 'raw_' + email.id)" class="text-gray-300 hover:text-white">
              {{ copyStatus['raw_' + email.id] || '复制原文' }}
            </button>
          </div>
          <pre class="whitespace-pre-wrap break-all">{{ email.raw_email }}</pre>
        </div>
      </div>
    </div>
  </div>

  <script>
    const { createApp, ref, computed, onMounted, watch } = Vue;
    
    createApp({
      setup() {
        const prefix = ref('');
        // 从 Worker 环境变量注入的域名
        const domain = '${env.DOMAIN || 'example.com'}';
        const emails = ref([]);
        const loading = ref(false);
        const history = ref([]);
        const copyStatus = ref({});
        
        const fullAddress = computed(() => (prefix.value + '@' + domain).toLowerCase());

        // 通用复制功能
        const copyToClipboard = async (text, key) => {
          try {
            await navigator.clipboard.writeText(text);
            copyStatus.value[key] = '已复制!';
            setTimeout(() => copyStatus.value[key] = undefined, 2000);
          } catch (err) {
            console.error('复制失败', err);
          }
        };

        // 加载历史记录
        const loadHistory = () => {
          const saved = localStorage.getItem('temp_mail_history');
          if (saved) {
            try { history.value = JSON.parse(saved); } catch(e){}
          }
        };

        // 保存到历史记录
        const saveToHistory = (p) => {
          if (!p) return;
          let arr = history.value.filter(x => x !== p);
          arr.unshift(p);
          if (arr.length > 10) arr = arr.slice(0, 10); // 最多保留10个
          history.value = arr;
          localStorage.setItem('temp_mail_history', JSON.stringify(arr));
        };

        const clearHistory = () => {
          history.value = [];
          localStorage.removeItem('temp_mail_history');
        };

        const selectHistory = (h) => {
          prefix.value = h;
          handlePrefixChange();
        };

        const generateRandom = () => {
          prefix.value = Math.random().toString(36).substring(2, 8);
          handlePrefixChange();
        };

        const handlePrefixChange = () => {
          if (prefix.value) {
            saveToHistory(prefix.value);
            emails.value = [];
            fetchEmails();
          }
        };

        const fetchEmails = async () => {
          if (!prefix.value) return;
          loading.value = true;
          try {
            console.log('Fetching from:', '/api/emails?address=' + fullAddress.value);
            const res = await fetch('/api/emails?address=' + fullAddress.value);
            const data = await res.json();
            console.log('Received data:', data);
            
            // 尝试使用 letterparser 解析邮件
            if (typeof letterparser !== 'undefined') {
              for (let i = 0; i < data.length; i++) {
                data[i].showRaw = false;
                try {
                  const parsed = letterparser.extract(data[i].raw_email);
                  data[i].parsed = {
                    subject: data[i].subject, // 优先用后端提取的
                    from: { address: data[i].from },
                    text: parsed.text || '',
                    html: parsed.html || null
                  };
                } catch (e) {
                  console.error('Letterparser error:', e);
                  // 降级到自己写的极简解析
                  data[i].parsed = fallbackParse(data[i]);
                }
              }
            } else {
              console.error('Letterparser library not found');
              for (let i = 0; i < data.length; i++) {
                data[i].showRaw = false;
                data[i].parsed = fallbackParse(data[i]);
              }
            }
            
            // 提取验证码逻辑
            for (let i = 0; i < data.length; i++) {
              if (!data[i].verificationCode && data[i].parsed) {
                const contentToScan = data[i].parsed.text || data[i].parsed.html || '';
                const cleanText = contentToScan.replace(/<[^>]*>?/gm, ' ');
                const match = cleanText.match(/(?:验证码|code|Code|CODE|passcode|token|pin)[\s:：]*([a-zA-Z0-9]{4,8})\b/i);
                const fallbackMatch = cleanText.match(/\b(\d{4,8})\b/);
                data[i].verificationCode = match ? match[1] : (fallbackMatch ? fallbackMatch[1] : null);
              }
            }
            
            emails.value = data;
          } catch (e) {
            console.error('获取邮件失败', e);
          }
          loading.value = false;
        };

        // 极简的后备解析函数
        const fallbackParse = (emailData) => {
          let fallbackText = '邮件正文解析库加载失败，请点击"查看原文"查看邮件内容。';
          try {
            const raw = emailData.raw_email || '';
            const textPartMatch = raw.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\r?\n--|$)/i);
            if (textPartMatch && textPartMatch[1]) {
              let content = textPartMatch[1].trim();
              if (raw.match(/Content-Transfer-Encoding:\s*base64/i)) {
                try { content = decodeURIComponent(escape(atob(content.replace(/\s/g, '')))); } catch(e) {}
              }
              fallbackText = content;
            }
          } catch(e) {}
          return {
            subject: emailData.subject,
            from: { address: emailData.from },
            text: fallbackText,
            html: null
          };
        };

        // 删除邮件
        const deleteEmail = async (id) => {
          if (!confirm('确定要删除这封邮件吗？')) return;
          try {
            const res = await fetch('/api/emails?id=' + id + '&address=' + fullAddress.value, {
              method: 'DELETE'
            });
            if (res.ok) {
              // 从列表中移除
              emails.value = emails.value.filter(e => e.id !== id);
            }
          } catch (e) {
            console.error('删除失败', e);
            alert('删除失败');
          }
        };

        onMounted(() => {
          loadHistory();
          // 如果有历史记录，默认使用上一次的邮箱；否则生成一个随机的
          if (history.value.length > 0) {
            prefix.value = history.value[0];
          } else {
            prefix.value = Math.random().toString(36).substring(2, 8);
            saveToHistory(prefix.value);
          }
          
          fetchEmails();
          // 取消自动刷新，改为纯手动刷新
          // setInterval(fetchEmails, 10000);
        });

        return { 
          prefix, domain, fullAddress, emails, loading, history, copyStatus,
          fetchEmails, generateRandom, selectHistory, clearHistory, handlePrefixChange,
          copyToClipboard, deleteEmail
        }
      }
    }).mount('#app')
  </script>
</body>
</html>
      `;
      return new Response(html, { 
        headers: { 'Content-Type': 'text/html;charset=UTF-8' } 
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
