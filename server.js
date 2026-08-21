// 味千拉面舆情工作台 —— 后端（零依赖 Node）
// 功能：注册→待审批→管理员同意→登录；JWT 鉴权；15 分钟爬虫调度；托管前端。
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const scrapers = require('./scrapers');
const store = require('./store');

const PORT = process.env.PORT || 3000;
// 静态资源目录：默认与 server.js 同级（适合 PaaS 整目录部署）
const PUBLIC_DIR = process.env.PUBLIC_DIR || __dirname;

// 首次启动：创建主管理员（环境变量 ADMIN_USER / ADMIN_PASS，未设则用 admin / admin123）
function seedAdmin() {
  const au = process.env.ADMIN_USER || 'admin';
  if (!auth.findUser(au)) {
    const pw = process.env.ADMIN_PASS || 'admin123';
    auth.addUser(au, pw, 'admin', 'approved');
    console.log('[seed] 主管理员已创建  账号: ' + au + '  密码: ' + pw + '  （请尽快改密码或设置 ADMIN_PASS 环境变量）');
  }
}
seedAdmin();

// 启动爬虫调度
scrapers.start(parseInt(process.env.SCRAPE_INTERVAL_MIN || '15', 10));

// ---------- 工具 ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve) => {
    let data = '', size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { req.destroy(); return; } data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(null); } });
  });
}
function getToken(req) { const h = req.headers['authorization'] || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; }
function authUser(req) {
  const t = getToken(req); if (!t) return null;
  const p = auth.verifyJWT(t); if (!p || p.status !== 'approved') return null;
  const u = auth.findUserById(p.uid); if (!u || u.status !== 'approved') return null;
  return u;
}
function serveFile(res, file) {
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file);
  const ct = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  fs.createReadStream(file).pipe(res);
}

// ---------- 路由 ----------
async function handleApi(req, res, url, method) {
  // 注册
  if (url === '/api/register' && method === 'POST') {
    const b = await readBody(req, 1e5);
    if (!b || !b.username || !b.password) return sendJSON(res, 400, { error: '用户名密码必填' });
    if (auth.findUser(b.username)) return sendJSON(res, 409, { error: '用户名已存在' });
    auth.addUser(b.username, b.password, 'viewer', 'pending');
    return sendJSON(res, 200, { ok: true, pending: true, msg: '注册成功，等待管理员审批' });
  }
  // 登录
  if (url === '/api/login' && method === 'POST') {
    const b = await readBody(req, 1e5);
    if (!b || !b.username || !b.password) return sendJSON(res, 400, { error: '用户名密码必填' });
    const u = auth.authenticate(b.username, b.password);
    if (!u) return sendJSON(res, 401, { error: '用户名或密码错误' });
    if (u.status === 'pending') return sendJSON(res, 403, { error: '账户待管理员审批' });
    const token = auth.signJWT({ uid: u.id, role: u.role, status: u.status });
    return sendJSON(res, 200, { token, user: { username: u.username, role: u.role, status: u.status } });
  }
  // 当前用户
  if (url === '/api/me' && method === 'GET') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, { user: { username: u.username, role: u.role, status: u.status } });
  }
  // 管理员：待审批列表
  if (url === '/api/admin/pending' && method === 'GET') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    const pend = store.getDb().users.filter(x => x.status === 'pending').map(x => ({ id: x.id, username: x.username, createdAt: x.createdAt }));
    return sendJSON(res, 200, { pending: pend });
  }
  // 管理员：审批通过
  if (url === '/api/admin/approve' && method === 'POST') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    const b = await readBody(req, 1e5);
    const tu = auth.approveUser(b.uid);
    if (!tu) return sendJSON(res, 404, { error: '用户不存在' });
    return sendJSON(res, 200, { ok: true, user: tu.username });
  }
  // 管理员：用户列表（含角色）
  if (url === '/api/admin/users' && method === 'GET') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    return sendJSON(res, 200, { users: auth.listUsers() });
  }
  // 管理员：设置用户角色（editor 编辑 / viewer 只读）
  if (url === '/api/admin/setrole' && method === 'POST') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    const b = await readBody(req, 1e5);
    const tu = auth.setRole(b.uid, b.role);
    if (!tu) return sendJSON(res, 404, { error: '用户不存在' });
    return sendJSON(res, 200, { ok: true, user: tu.username, role: tu.role });
  }
  // 舆情数据
  if (url === '/api/data' && method === 'GET') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    return sendJSON(res, 200, scrapers.current());
  }
  // 标记预警已处理（编辑/管理员可操作，只读不可）
  let m = url.match(/^\/api\/alert\/([^/]+)\/done$/);
  if (m && method === 'POST') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role === 'viewer') return sendJSON(res, 403, { error: '只读权限，无法操作' });
    return sendJSON(res, 200, scrapers.markDone(decodeURIComponent(m[1])));
  }
  // 转跟进（编辑/管理员可操作，只读不可）
  m = url.match(/^\/api\/alert\/([^/]+)\/follow$/);
  if (m && method === 'POST') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role === 'viewer') return sendJSON(res, 403, { error: '只读权限，无法操作' });
    return sendJSON(res, 200, scrapers.markFollow(decodeURIComponent(m[1])));
  }
  // 导出
  if (url === '/api/export' && method === 'GET') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scrapers.current(), null, 2));
    return;
  }
  // 导入（仅管理员）
  if (url === '/api/import' && method === 'POST') {
    const u = authUser(req); if (!u) return sendJSON(res, 401, { error: '未登录' });
    if (u.role !== 'admin') return sendJSON(res, 403, { error: '需要管理员权限' });
    const b = await readBody(req, 5e6);
    if (!b || !b.trend) return sendJSON(res, 400, { error: '格式错误' });
    return sendJSON(res, 200, scrapers.replace(b));
  }
  return sendJSON(res, 404, { error: 'unknown api' });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;
  if (url.startsWith('/api/')) { await handleApi(req, res, url, method); return; }
  // 静态资源（前端）
  if (method === 'GET') {
    let f = url === '/' ? '/index.html' : url;
    serveFile(res, path.join(PUBLIC_DIR, f.replace(/^\//, '')));
    return;
  }
  sendJSON(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('[server] 味千舆情工作台后端已启动: http://localhost:' + PORT);
});
