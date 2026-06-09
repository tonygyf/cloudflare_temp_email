export default {
  // Cloudflare Email Routing 触发接收邮件
  async email(message, env, ctx) {
    try {
      let address = message.to.toLowerCase();
      const prefix = address.split('@')[0];
      const targetDomain = (env.DOMAIN || 'gyf123.dpdns.org').toLowerCase();
      address = `${prefix}@${targetDomain}`;

      // 获取原始邮件文本
      const rawEmail = await new Response(message.raw).text();

      // 存入 D1
      await env.DB.prepare(
        `INSERT INTO emails (address, raw_email) VALUES (?, ?)`
      ).bind(address, rawEmail).run();
    } catch (err) {
      console.error("Failed to process email:", err);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API: 获取邮件
    if (request.method === 'GET' && url.pathname === '/api/emails') {
      const address = (url.searchParams.get('address') || '').toLowerCase().trim();
      if (!address) {
        return new Response(JSON.stringify({ error: 'Missing address parameter' }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      try {
        const prefix = address.split('@')[0];

        const { results } = await env.DB.prepare(
          `SELECT id, created_at, raw_email FROM emails WHERE address LIKE ? ORDER BY id DESC LIMIT 50`
        ).bind(`${prefix}@%`).all();

        // 解析邮件（极简方式）
        const formattedResults = results.map(row => {
          const raw = row.raw_email || '';

          // 提取发件人
          const fromMatch = raw.match(/^From:\s*(.+)$/im);
          const subjectMatch = raw.match(/^Subject:\s*(.+)$/im);

          // 提取正文 (text/plain 或 html)
          let text = '';
          try {
            const parts = raw.split(/\r?\n\r?\n/);
            text = parts.slice(1).join('\n'); // 去掉头部
            text = text.replace(/<[^>]*>/gm, ''); // 简单去 HTML 标签
          } catch(e){}

          // 提取验证码
          const codeMatch = text.match(/(?:验证码|code|Code|CODE|passcode|token|pin)[\s:：]*([a-zA-Z0-9]{4,8})\b/i)
                         || text.match(/\b(\d{4,8})\b/);

          return {
            id: row.id,
            created_at: row.created_at,
            from: fromMatch ? fromMatch[1].trim() : 'Unknown',
            subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
            text: text,
            verificationCode: codeMatch ? codeMatch[1] : null,
            raw_email: row.raw_email
          };
        });

        return new Response(JSON.stringify(formattedResults), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // API: 删除邮件
    if (request.method === 'DELETE' && url.pathname === '/api/emails') {
      const id = url.searchParams.get('id');
      const address = (url.searchParams.get('address') || '').toLowerCase().trim();
      if (!id || !address) return new Response('Missing parameters', { status: 400 });

      const prefix = address.split('@')[0];
      try {
        await env.DB.prepare(
          `DELETE FROM emails WHERE id = ? AND address LIKE ?`
        ).bind(id, `${prefix}@%`).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // 前端页面
    if (url.pathname === '/') {
      const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>极简临时邮箱</title>
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
<style>
body{font-family:system-ui;background:#f3f4f6;padding:1rem}
.container{max-width:800px;margin:auto}
.email-card{background:white;padding:1rem;margin-bottom:1rem;border-radius:0.5rem;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
button{cursor:pointer}
pre{white-space:pre-wrap;word-break:break-word;font-family:monospace}
</style>
</head>
<body>
<div id="app" class="container">
<h1>临时邮箱</h1>
<div>
<input v-model="prefix" placeholder="输入邮箱前缀" @change="fetchEmails">
<span>@${env.DOMAIN || 'gyf123.dpdns.org'}</span>
<button @click="randomPrefix">随机</button>
<button @click="fetchEmails">刷新</button>
</div>

<div v-if="loading">加载中...</div>
<div v-for="email in emails" :key="email.id" class="email-card">
  <p><strong>主题:</strong> {{email.subject}}</p>
  <p><strong>发件人:</strong> {{email.from}}</p>
  <p v-if="email.verificationCode"><strong>验证码:</strong> {{email.verificationCode}}</p>
  <pre>{{email.text}}</pre>
  <button @click="deleteEmail(email.id)">删除</button>
</div>
</div>

<script>
const { createApp, ref } = Vue;
createApp({
  setup(){
    const prefix = ref('test');
    const emails = ref([]);
    const loading = ref(false);

    const fetchEmails = async ()=>{
      if(!prefix.value) return;
      loading.value = true;
      try{
        const res = await fetch('/api/emails?address='+prefix.value+'@${env.DOMAIN || 'gyf123.dpdns.org'}');
        const data = await res.json();
        emails.value = data;
      }catch(e){console.error(e)}
      loading.value = false;
    };

    const deleteEmail = async (id)=>{
      try{
        await fetch('/api/emails?id='+id+'&address='+prefix.value+'@${env.DOMAIN || 'gyf123.dpdns.org'}',{method:'DELETE'});
        emails.value = emails.value.filter(e=>e.id!==id);
      }catch(e){console.error(e)}
    };

    const randomPrefix = ()=>{prefix.value=Math.random().toString(36).slice(2,8);fetchEmails()};

    return {prefix, emails, loading, fetchEmails, deleteEmail, randomPrefix}
  }
}).mount('#app')
</script>
</body>
</html>
      `;
      return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8'}});
    }

    return new Response('Not Found',{status:404});
  }
};