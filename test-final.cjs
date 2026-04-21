const http = require('http');

async function post(uri, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri, 'http://localhost:3001');
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

async function get(uri, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri, 'http://localhost:3001');
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method: 'GET',
      headers,
    };
    const req = http.request(opts, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.end();
  });
}

async function patch(uri, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(uri, 'http://localhost:3001');
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: url.hostname, port: url.port,
      path: url.pathname, method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

async function main() {
  // 1. Auth
  const auth = await post('/auth/token', { username: 'admin', password: 'changeme' });
  const { token } = JSON.parse(auth.body);
  const H = { Authorization: `Bearer ${token}` };

  // 2. Create task with user_id=admin (JWT provides admin)
  const t1 = await post('/v1/archive/tasks', {
    session_id: 's1', turn_id: 1,
    command: { action: 'research', task: 'AI 路由技术研究', constraints: [], priority: 'high' },
    user_input: '请研究 AI 路由技术', constraints: [],
  }, H);
  console.log('Create (admin):', t1.status, t1.body.substring(0, 80));

  const t2 = await post('/v1/archive/tasks', {
    session_id: 's1', turn_id: 2,
    command: { action: 'analysis', task: '市场分析报告', constraints: [], priority: 'normal' },
    user_input: '请分析市场趋势', constraints: [],
  }, H);
  console.log('Create (admin):', t2.status, t2.body.substring(0, 80));

  const d1 = JSON.parse(t1.body);
  const d2 = JSON.parse(t2.body);

  // 3. Update statuses
  await patch(`/v1/archive/tasks/${d1.id}/status`, { status: 'running' }, H);
  await patch(`/v1/archive/tasks/${d2.id}/status`, { status: 'done' }, H);
  await patch(`/v1/archive/tasks/${d1.id}/status`, { status: 'done' }, H);
  console.log('Status updates done');

  // 4. Kanban query - admin
  const kanban = await get('/v1/archive/tasks', H);
  const k = JSON.parse(kanban.body);
  console.log('\nKanban (admin) status:', kanban.status);
  console.log('Count:', k.count, '| Total:', k.total);
  k.entries && k.entries.forEach(e => console.log(`  [${e.status}] ${e.id.substring(0,8)} | ${e.command.task}`));

  // 5. Dashboard
  const dash = await get('/api/dashboard/admin', H);
  const dd = JSON.parse(dash.body);
  console.log('\nDashboard (admin) status:', dash.status);
  console.log(JSON.stringify(dd, null, 2));
}

main().catch(console.error);
