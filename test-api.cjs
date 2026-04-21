const http = require('http');

async function post(uri, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri, 'http://localhost:3001');
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function get(uri, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri, 'http://localhost:3001');
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function patch(uri, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri, 'http://localhost:3001');
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // 1. Get JWT token
  console.log('=== 1. Auth ===');
  const auth = await post('/auth/token', { username: 'admin', password: 'changeme' });
  console.log('Auth status:', auth.status);
  const { token } = JSON.parse(auth.body);
  console.log('Token OK:', token ? 'YES' : 'NO');
  const headers = { Authorization: `Bearer ${token}` };

  // 2. Create archive task
  console.log('\n=== 2. Create Archive Task ===');
  const create = await post('/v1/archive/tasks', {
    session_id: 'test-session-001',
    turn_id: 1,
    command: { action: 'research', task: '测试 AI 路由技术研究', constraints: [], priority: 'normal' },
    user_input: '请帮我研究 AI 路由技术',
    constraints: [],
    user_id: 'dev-user',
  }, headers);
  console.log('Create status:', create.status);
  console.log('Response:', create.body.substring(0, 200));
  const taskData = JSON.parse(create.body);
  const taskId = taskData.id;
  console.log('Task ID:', taskId);

  if (create.status === 201 && taskId) {
    // 3. Update status to running
    console.log('\n=== 3. Update Status to Running ===');
    const up = await patch(`/v1/archive/tasks/${taskId}/status`, { status: 'running' }, headers);
    console.log('Update status:', up.status, up.body);

    // 4. Mark done
    console.log('\n=== 4. Mark Done ===');
    const done = await patch(`/v1/archive/tasks/${taskId}/status`, { status: 'done' }, headers);
    console.log('Done status:', done.status, done.body);
  }

  // 5. Kanban view (with user_id=dev-user)
  console.log('\n=== 5. Kanban View (dev-user) ===');
  const kanban = await get('/v1/archive/tasks?user_id=dev-user', headers);
  console.log('Kanban status:', kanban.status);
  try {
    const k = JSON.parse(kanban.body);
    console.log('Count:', k.count, '| Total:', k.total);
    if (k.entries && k.entries.length > 0) {
      k.entries.forEach(e => console.log(`  [${e.status}] ${e.id} | ${e.user_input.substring(0, 50)}`));
    } else {
      console.log('(empty)');
    }
  } catch (e) {
    console.log('Raw:', kanban.body.substring(0, 300));
  }

  // 6. Dashboard
  console.log('\n=== 6. Dashboard ===');
  const dash = await get('/api/dashboard/dev-user', headers);
  console.log('Dashboard status:', dash.status);
  try {
    const d = JSON.parse(dash.body);
    console.log('Tasks total:', d.tasks_total, '| Active:', d.tasks_active, '| Decisions:', d.decisions_total);
  } catch (e) {
    console.log('Raw:', dash.body.substring(0, 300));
  }

  // 7. Chat (execute mode)
  console.log('\n=== 7. Chat (non-stream, 30s timeout) ===');
  const chat = await post('/api/chat', {
    message: '你好，简要介绍一下你自己',
    stream: false,
    mode: 'execute',
  }, headers);
  console.log('Chat status:', chat.status);
  try {
    const c = JSON.parse(chat.body);
    console.log('Response length:', c.response ? c.response.length : 0);
    console.log('First 200 chars:', c.response ? c.response.substring(0, 200) : c);
  } catch (e) {
    console.log('Raw:', chat.body.substring(0, 300));
  }
}

main().catch(console.error);
