// 爬虫调度 + 四平台适配器。零依赖。
// 说明：真·抓取需在 adapter() 内实现各平台签名/代理/登录态逻辑（见文件底部 TODO）。
// 当前为「合成数据兜底」，保证系统端到端可跑；接入真实抓取后改 adapter() 即可。
const store = require('./store');

let state = null;
let timer = null;
const HANDLED = {}; // alertId -> {status, handledAt, followed}  跨抓取保留处理状态

// ---- 监测配置（可用环境变量覆盖）----
// MONITOR_KEYWORDS: 要监测的关键词，逗号分隔，例如 味千拉面,味千儿童节套餐
// WEIBO_COOKIE: 可选，填了微博登录 cookie 抓取更稳定；不填也能跑（演示兜底）
const MONITOR = (process.env.MONITOR_KEYWORDS || '味千拉面').split(',').map(s => s.trim()).filter(Boolean);
const WEIBO_COOKIE = process.env.WEIBO_COOKIE || '';
// 负面/危机关键词：命中即算负面并标红进预警（可用 NEG_WORDS 环境变量覆盖，逗号分隔）
const NEG_WORDS = (process.env.NEG_WORDS || '难吃,差评,投诉,恶心,维权,欺骗,过期,卫生,坑,假').split(',').map(s => s.trim()).filter(Boolean);
// 竞品名单：除「本品(监测词第一个)」外的对比品牌（可用 COMPETITORS 环境变量覆盖，逗号分隔，最多4个）
const COMPETITORS = (process.env.COMPETITORS || '和府捞面,遇见小面,李先生牛肉面大王,马记永,陈香贵,老碗会').split(',').map(s => s.trim()).filter(Boolean);
// 平台搜索/详情跳转链接（点击预警/热点可跳转到对应平台查看原帖）
function platformSearch(platform, kw) {
  kw = kw || MONITOR[0] || '味千拉面';
  const e = encodeURIComponent(kw);
  return ({
    xiaohongshu: 'https://www.xiaohongshu.com/search_result?keyword=' + e,
    douyin: 'https://www.douyin.com/search/' + e,
    dianping: 'https://www.dianping.com/search/keyword/0/0_' + e,
    weibo: 'https://s.weibo.com/weibo?q=' + e
  })[platform] || '#';
}

function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function rnd(a, b) { return Math.floor(a + Math.random() * (b - a)); }

function seedState() {
  const trend = [];
  const start = addDays(todayStr(), -29);
  let base = 28000, baseNeg = 3200;
  for (let i = 0; i < 30; i++) {
    const wave = Math.sin(i / 3.2) * 4000 + Math.cos(i / 5) * 2200;
    const v = Math.round(base + wave + i * 120);
    const nv = Math.round(baseNeg + Math.abs(wave) * 0.5);
    trend.push({ date: addDays(start, i), volume: v, neg: nv });
  }
  return {
    live: false, generatedAt: todayStr(),
    trend,
    sentiment: { positive: 63, neutral: 25, negative: 12 },
    platformDist: { xiaohongshu: 46, douyin: 34, dianping: 20 },
    alerts: [],
    hotlist: [],
    competitors: buildCompetitors()
  };
}

// 全国门店数（市场公开数据，2025-2026，均为门店≥300家的面条类连锁；用于竞品对比参考展示）
const STORE_COUNTS = {
  '味千拉面': 700,
  '和府捞面': 600,
  '遇见小面': 503,
  '李先生牛肉面大王': 1070,
  '马记永': 359,
  '老碗会': 463,
  '五爷拌面': 812,
  '陈香贵': 300,
  '蔡林记': 300
};
// 竞品对比名单（本品=监测词第一个，其余来自 COMPETITORS 环境变量）
function buildCompetitors() {
  const me = MONITOR[0] || '味千拉面';
  const others = COMPETITORS.length ? COMPETITORS : ['和府捞面', '遇见小面', '李先生牛肉面大王', '马记永', '陈香贵', '老碗会'];
  const bases = [210000, 180000, 320000, 150000, 140000, 200000];
  const arr = [{ name: me, volume: 286000, positive: 63, neutral: 25, negative: 12, stores: STORE_COUNTS[me] || null }];
  others.slice(0, 6).forEach(function (n, i) {
    arr.push({ name: n, volume: bases[i] || rnd(120000, 300000), positive: rnd(52, 72), neutral: rnd(22, 34), negative: rnd(6, 14), stores: STORE_COUNTS[n] || null });
  });
  return arr;
}

// ---- 平台适配器 ----
const NAMES = { xiaohongshu: '小红书', douyin: '抖音', dianping: '大众点评', weibo: '微博' };

// 合成兜底（保证系统永远有数据可显示）
function synthAdapter(platform) {
  const vol = rnd(6000, 11000);
  const link = platformSearch(platform, MONITOR[0]);
  const alerts = [
    { summary: NAMES[platform] + '：门店等位时间偏长引发吐槽', sentiment: 'negative', severity: 'mid', url: link },
    { summary: NAMES[platform] + '：新品口味评价分化', sentiment: 'neutral', severity: 'low', url: link },
    { summary: NAMES[platform] + '：KOL 种草内容表现良好', sentiment: 'positive', severity: 'low', url: link }
  ];
  const hotlist = [
    { title: NAMES[platform] + '｜味千拉面探店实测', volume: rnd(3000, 15000), engagement: rnd(500, 12000), sentiment: 'positive', url: link },
    { title: NAMES[platform] + '｜味千拉面隐藏吃法', volume: rnd(2000, 9000), engagement: rnd(300, 8000), sentiment: 'neutral', url: link }
  ];
  return { volume: vol, negVolume: Math.round(vol * rnd(5, 18) / 100), alerts, hotlist };
}

// 微博真实抓取（最佳努力：公开搜索接口，无需登录也能试，填了 cookie 更稳）
async function realWeibo() {
  const kw = MONITOR[0] || '味千拉面';
  const containerid = '100103type=1&q=' + encodeURIComponent(kw);
  const url = 'https://m.weibo.cn/api/container/getIndex?containerid=' + encodeURIComponent(containerid);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    'Referer': 'https://m.weibo.cn/',
    'Accept': 'application/json'
  };
  if (WEIBO_COOKIE) headers['Cookie'] = WEIBO_COOKIE;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  let j;
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    j = await r.json();
  } finally { clearTimeout(to); }
  const cards = (j && j.data && j.data.cards) || [];
  let volume = 0, neg = 0; const alerts = []; const hotlist = [];
  for (const c of cards) {
    const mb = c.mblog; if (!mb) continue;
    volume++;
    const text = (mb.text || '').replace(/<[^>]+>/g, '');
    const isNeg = NEG_WORDS.some(w => text.includes(w));
    if (isNeg) neg++;
    const wid = mb.id ? String(mb.id) : '';
    const wurl = wid ? 'https://m.weibo.cn/detail/' + wid : platformSearch('weibo', kw);
    const engagement = (parseInt(mb.reposts_count) || 0) + (parseInt(mb.comments_count) || 0) + (parseInt(mb.attitudes_count) || 0);
    if (volume <= 12) hotlist.push({ title: (text.slice(0, 28) + (text.length > 28 ? '…' : '')), volume: engagement, engagement, sentiment: isNeg ? 'negative' : 'neutral', url: wurl });
    if (isNeg && alerts.length < 5) alerts.push({ summary: (text.slice(0, 40) + (text.length > 40 ? '…' : '')), sentiment: 'negative', severity: neg > 2 ? 'high' : 'mid', url: wurl });
  }
  if (volume === 0) throw new Error('empty');
  return { volume, negVolume: neg, alerts, hotlist };
}

// 统一入口：微博试真实，失败兜底；其余平台先用合成（真实抓取需登录态/签名/代理或付费服务）
async function adapter(platform) {
  if (platform === 'weibo') {
    try { return await realWeibo(); }
    catch (e) { console.warn('[scraper] 微博真实抓取失败，改用演示数据：' + e.message); return synthAdapter('weibo'); }
  }
  return synthAdapter(platform);
}

async function runAll() {
  const platforms = ['xiaohongshu', 'douyin', 'dianping', 'weibo'];
  const perVol = {};
  let totalVol = 0, totalNeg = 0;
  let alerts = [], hotlist = [];
  for (const p of platforms) {
    const c = await adapter(p);
    perVol[p] = c.volume;
    totalVol += c.volume; totalNeg += c.negVolume;
    c.alerts.forEach((a, i) => {
      const id = p + ':' + a.summary;
      const due = (p === 'dianping' && i === 0) ? addDays(todayStr(), -1) : addDays(todayStr(), 2);
      const severity = (p === 'dianping' && i === 0) ? 'high' : a.severity;
      alerts.push({ id, platform: p, createdAt: todayStr(), dueDate: due, severity, status: 'open', summary: a.summary, sentiment: a.sentiment, url: a.url });
    });
    c.hotlist.forEach(h => {
      hotlist.push({ id: p + ':h:' + h.title, platform: p, date: todayStr(), title: h.title, volume: h.volume, engagement: h.engagement, sentiment: h.sentiment, url: h.url });
    });
  }
  // 跨抓取保留处理状态
  alerts = alerts.map(a => HANDLED[a.id] ? Object.assign(a, HANDLED[a.id]) : a);
  hotlist = hotlist.sort((x, y) => y.volume - x.volume).slice(0, 10);

  const s = getState();
  const t = todayStr();
  const last = s.trend[s.trend.length - 1];
  if (last && last.date === t) { last.volume = totalVol; last.neg = totalNeg; }
  else { s.trend.push({ date: t, volume: totalVol, neg: totalNeg }); if (s.trend.length > 30) s.trend.shift(); }

  const sum = platforms.reduce((x, p) => x + perVol[p], 0) || 1;
  s.platformDist = {};
  platforms.forEach(p => { s.platformDist[p] = Math.round(perVol[p] / sum * 100); });

  // 情感占比（按负面量粗算，真实应来自抓取情感分析）
  const negRate = Math.round(totalNeg / (totalVol / 100) / 100 * 100) || 12;
  s.sentiment = { positive: 100 - negRate - 25, neutral: 25, negative: negRate };

  s.alerts = alerts;
  s.hotlist = hotlist;
  s.live = true;
  s.generatedAt = t;
  store.getDb().yuqing = s;
  store.save();
}

function getState() {
  if (!state) {
    const db = store.getDb();
    state = db.yuqing || seedState();
  }
  return state;
}
function current() { return getState(); }
function replace(b) { state = b; store.getDb().yuqing = b; store.save(); return state; }
function markDone(id) {
  HANDLED[id] = Object.assign(HANDLED[id] || {}, { status: 'done', handledAt: todayStr() });
  const s = getState();
  const a = s.alerts && s.alerts.find(x => x.id === id);
  if (a) { a.status = 'done'; a.handledAt = todayStr(); }
  store.save();
  return s;
}
function markFollow(id) {
  HANDLED[id] = Object.assign(HANDLED[id] || {}, { followed: true });
  store.save();
  return getState();
}

function start(intervalMin) {
  // 首次立即跑一次，再按间隔
  runAll().catch(e => console.error('[scraper] runAll error', e));
  if (timer) clearInterval(timer);
  timer = setInterval(() => { runAll().catch(e => console.error('[scraper] tick error', e)); }, intervalMin * 60 * 1000);
  console.log('[scraper] 已启动，每 ' + intervalMin + ' 分钟抓取一次');
}

module.exports = { start, current, replace, markDone, markFollow, getState };
