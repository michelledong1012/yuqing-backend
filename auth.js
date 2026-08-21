// 鉴权：密码哈希(scrypt) + JWT(HMAC-SHA256) + 用户/审批。零依赖。
const crypto = require('crypto');
const store = require('./store');

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-prod';

function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); return Buffer.from(s, 'base64'); }

function signJWT(payload) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
  return h + '.' + p + '.' + sig;
}
function verifyJWT(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(parts[0] + '.' + parts[1]).digest());
  if (sig !== parts[2]) return null;
  try { return JSON.parse(b64urlDecode(parts[1]).toString()); } catch (e) { return null; }
}

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPw(pw, salt, hash) {
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
}

function getUsers() { return store.getDb().users; }
function findUser(username) { return getUsers().find(u => u.username === username); }
function findUserById(id) { return getUsers().find(u => u.id === id); }

function addUser(username, password, role, status) {
  const { salt, hash } = hashPw(password);
  const u = {
    id: 'u' + Date.now() + Math.floor(Math.random() * 1000),
    username, salt, hash,
    role: role || 'viewer',
    status: status || 'pending',   // pending | approved
    createdAt: new Date().toISOString()
  };
  getUsers().push(u);
  store.save();
  return u;
}
function authenticate(username, password) {
  const u = findUser(username);
  if (!u) return null;
  if (!verifyPw(password, u.salt, u.hash)) return null;
  return u;
}
function approveUser(id) {
  const u = findUserById(id);
  if (u) { u.status = 'approved'; store.save(); }
  return u;
}
// 角色：admin 主管理员 / editor 编辑(可处理预警) / viewer 只读(仅查看)
function setRole(id, role) {
  const u = findUserById(id);
  if (u && ['admin', 'editor', 'viewer'].includes(role)) { u.role = role; store.save(); }
  return u;
}
function listUsers() {
  return getUsers().map(u => ({ id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt }));
}

module.exports = {
  signJWT, verifyJWT,
  getUsers, findUser, findUserById,
  addUser, authenticate, approveUser, setRole, listUsers
};
