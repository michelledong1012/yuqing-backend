// 轻量 JSON 持久化（零依赖）。小团队舆情台够用；可平滑替换为 SQLite/Postgres。
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let cache = null;
let writeChain = Promise.resolve();

function ensure() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function defaultDb() {
  return { users: [], yuqing: null, meta: { createdAt: new Date().toISOString() } };
}

function load() {
  ensure();
  if (cache) return cache;
  if (fs.existsSync(DB_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { cache = null; }
  }
  if (!cache || typeof cache !== 'object') { cache = defaultDb(); saveSync(); }
  if (!cache.users) cache.users = [];
  return cache;
}

function saveSync() {
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
}

function save() {
  writeChain = writeChain.then(() => { try { saveSync(); } catch (e) { console.error('[store] save error', e); } return null; });
  return writeChain;
}

module.exports = { load, save, getDb: () => load() };
