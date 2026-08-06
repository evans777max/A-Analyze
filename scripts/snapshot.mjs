// 每日收盘评分快照（GitHub Actions 定时执行，北京时间约15:20）
// 产出 data/history.json：全端一致的评分历史，页面直接读取
// ⚠️ 本脚本复刻 index.html 的评分模型——页面改模型时必须同步本文件（见 .kiro/memory/项目记忆.md）
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const HOME = "bj920021";
const IDX_CANDS = ["sh000001", "sz399001", "sz399006", "sh000688", "sz399971", "bj899050"];
const QUOTE_EXTRA = ["hkHSTECH", "usDJI", "usIXIC", "usINX"];

// 从页面源码提取标的池与精筛基线，避免双份维护
const PEERS = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*corr90: ([\d.]+)/g)]
  .map(m => ({ sym: m[1], corr90: +m[2] }));
const WATCH = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*tag:/g)]
  .map(m => m[1])
  .filter(s => !IDX_CANDS.includes(s)); // 排除 INDEXES 数组的同构条目（指数不作为个股评分）
const STOCKS = [...new Set([HOME, ...PEERS.map(p => p.sym), ...WATCH])];
const ALL_K = [...new Set([...STOCKS, ...IDX_CANDS])];

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 数据获取 ---------- */
async function fetchQuotes(syms) {
  const url = "https://qt.gtimg.cn/q=" + syms.join(",");
  const r = await fetch(url, UA);
  const txt = new TextDecoder("gbk").decode(await r.arrayBuffer());
  const q = {};
  for (const sym of syms) {
    const m = txt.match(new RegExp('v_' + sym + '="([^"]*)"'));
    if (!m) continue;
    const f = m[1].split("~");
    if (f.length < 49) continue;
    q[sym] = {
      price: +f[3], prev: +f[4], time: f[30], pct: +f[32],
      high: +f[33], low: +f[34], turnover: +f[38]
    };
  }
  return q;
}

async function fetchK(sym) {
  try {
    const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=90`;
    const r = await fetch(url, { ...UA, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (Array.isArray(j) && j.length > 10) {
      return j.map(b => ({ day: b.day, open: +b.open, high: +b.high, low: +b.low, close: +b.close, vol: +b.volume }));
    }
  } catch (e) {}
  try { // 东财备源
    const secid = (sym.startsWith("sh") ? "1." : "0.") + sym.slice(2);
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&end=20500101&lmt=90`;
    const r = await fetch(url, { ...UA, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const d = j && j.data && j.data.klines;
    if (d && d.length > 10) {
      return d.map(l => { const p = l.split(","); return { day: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], vol: +p[5] }; });
    }
  } catch (e) {}
  return null;
}

/* ---------- 模型（与 index.html 同口径） ---------- */
const lin = (x, lo, hi) => Number.isFinite(x) ? Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100)) : null;
const ma = (c, n) => c.length >= n ? c.slice(-n).reduce((s, x) => s + x, 0) / n : null;
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  const A = a.slice(-n), B = b.slice(-n);
  const ma_ = A.reduce((s, x) => s + x, 0) / n, mb = B.reduce((s, x) => s + x, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = A[i] - ma_, db = B[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  return (va === 0 || vb === 0) ? null : cov / Math.sqrt(va * vb);
}
const rets = bars => { const r = []; for (let i = 1; i < bars.length; i++) if (bars[i - 1].close) r.push(bars[i].close / bars[i - 1].close - 1); return r; };
const benchFor = sym => sym.startsWith("bj") ? "bj899050" : sym.startsWith("sh688") ? "sh000688" : sym.startsWith("sz3") ? "sz399006" : sym.startsWith("sz") ? "sz399001" : "sh000001";
const limitFor = sym => IDX_CANDS.includes(sym) ? 10 : sym.startsWith("bj") ? 30 : (sym.startsWith("sh688") || sym.startsWith("sz30")) ? 20 : 10;
const layerScore = rows => {
  const v = rows.filter(r => Number.isFinite(r.score));
  if (!v.length) return null;
  const w = v.reduce((s, r) => s + r.w, 0);
  return v.reduce((s, r) => s + r.score * r.w, 0) / w;
};

function run(Q, K) {
  const l1For = sym => {
    const B = benchFor(sym), bz = Q[B], sh = Q["sh000001"], cyb = Q["sz399006"];
    const spreadRef = B === "sh000001" ? Q["sz399001"] : sh;
    const rows = [];
    if (bz) rows.push({ score: lin(bz.pct, -2, 2), w: 40 });
    if (B !== "sh000001" && sh) rows.push({ score: lin(sh.pct, -1.5, 1.5), w: 25 });
    else if (B === "sh000001" && Q["sz399001"]) rows.push({ score: lin(Q["sz399001"].pct, -1.5, 1.5), w: 25 });
    if (B !== "sz399006" && cyb) rows.push({ score: lin(cyb.pct, -2.5, 2.5), w: 15 });
    if (bz && spreadRef) rows.push({ score: lin(bz.pct - spreadRef.pct, -1.5, 1.5), w: 20 });
    return layerScore(rows);
  };
  const l2 = layerScore([
    Q["usIXIC"] && { score: lin(Q["usIXIC"].pct, -2, 2), w: 30 },
    Q["usINX"] && { score: lin(Q["usINX"].pct, -1.5, 1.5), w: 20 },
    Q["hkHSTECH"] && { score: lin(Q["hkHSTECH"].pct, -2.5, 2.5), w: 25 }
  ].filter(Boolean));

  const linkedTop = sym => {
    const bars = K[sym];
    if (!bars) return [];
    const my = rets(bars).slice(-30);
    if (my.length < 20) return [];
    const cands = [];
    for (const o of [...new Set([HOME, ...STOCKS, ...IDX_CANDS])]) {
      if (o === sym || !K[o] || !Q[o]) continue;
      const or_ = rets(K[o]).slice(-30);
      if (Math.min(my.length, or_.length) < 20) continue;
      const c = corr(my, or_);
      if (c !== null && c >= 0.30) cands.push({ sym: o, c });
    }
    return cands.sort((a, b) => b.c - a.c).slice(0, 5);
  };
  const l3For = sym => {
    if (sym === HOME) {
      let ws = 0, ps = 0, up = 0, ok = 0;
      for (const p of PEERS) {
        const pq = Q[p.sym];
        if (pq && Number.isFinite(pq.pct)) { ws += p.corr90; ps += p.corr90 * pq.pct * 10 / limitFor(p.sym); ok++; if (pq.pct > 0) up++; }
      }
      const rows = [];
      if (ok) { rows.push({ score: lin(ps / ws, -3, 3), w: 45 }, { score: up / ok * 100, w: 15 }); }
      if (Q["sz399971"]) rows.push({ score: lin(Q["sz399971"].pct, -2.5, 2.5), w: 20 });
      if (Q["sh000688"]) rows.push({ score: lin(Q["sh000688"].pct, -2.5, 2.5), w: 20 });
      return layerScore(rows);
    }
    const top = linkedTop(sym);
    if (!top.length) return null;
    let ws = 0, ps = 0, up = 0;
    for (const t of top) { const pq = Q[t.sym]; ws += t.c; ps += t.c * pq.pct * 10 / limitFor(t.sym); if (pq.pct > 0) up++; }
    return layerScore([{ score: lin(ps / ws, -3, 3), w: 70 }, { score: up / top.length * 100, w: 30 }]);
  };
  const l4For = sym => {
    const q = Q[sym], bars = K[sym], B = benchFor(sym), bq = Q[B], bBars = K[B];
    if (!q || !bars || bars.length < 21) return null;
    const c = bars.map(b => b.close), p = c[c.length - 1];
    const m5 = ma(c, 5), m10 = ma(c, 10), m20 = ma(c, 20);
    const rows = [{ score: lin((p / m20 - 1) * 100, -6, 6), w: 20 }];
    let maS = 10;
    if (p > m5 && m5 > m10 && m10 > m20) maS = 100; else if (p > m5 && m5 > m10) maS = 75; else if (p > m5) maS = 55; else if (p > m20) maS = 40;
    rows.push({ score: maS, w: 20 });
    if (bq) rows.push({ score: lin(q.pct - bq.pct, -3, 3), w: 20 });
    if (bq && bBars && bars.length >= 6 && bBars.length >= 6) {
      const cb = bBars.map(b => b.close);
      const rs5 = ((c[c.length - 1] / c[c.length - 6] - 1) - (cb[cb.length - 1] / cb[cb.length - 6] - 1)) * 100;
      rows.push({ score: lin(rs5, -6, 6), w: 20 });
    }
    const prev20 = bars.slice(0, -1).slice(-20);
    const h20 = Math.max(...prev20.map(b => b.high)), l20 = Math.min(...prev20.map(b => b.low));
    if (h20 > l20) rows.push({ score: Math.max(0, Math.min(100, (p - l20) / (h20 - l20) * 100)), w: 20 });
    const vols = bars.slice(0, -1).slice(-5).map(b => b.vol);
    const avg5 = vols.length ? vols.reduce((s, x) => s + x, 0) / vols.length : null;
    const tv = bars[bars.length - 1].vol;
    if (avg5 && tv) {
      const vr = tv / avg5; // 收盘后无需折算
      rows.push({ score: q.pct >= 0 ? lin(vr, 0.6, 2.5) : 100 - lin(vr, 0.6, 2.5), w: 20 });
    }
    return layerScore(rows);
  };
  const rsPen = sym => {
    const q = Q[sym], bq = Q[benchFor(sym)];
    if (!q || !bq) return 0;
    const rs = q.pct - bq.pct;
    return rs >= -1.5 ? 0 : Math.min(15, (Math.abs(rs) - 1.5) * 10);
  };
  const ohPen = sym => {
    const bars = K[sym];
    if (!bars || bars.length < 3) return 0;
    const c = bars.map(b => b.close), last = c[c.length - 1], lim = limitFor(sym);
    const r2 = c.length >= 3 ? (last / c[c.length - 3] - 1) * 100 : null;
    const r5 = c.length >= 6 ? (last / c[c.length - 6] - 1) * 100 : null;
    const p2 = r2 !== null ? Math.max(0, (r2 - 1.5 * lim) / lim * 30) : 0;
    const p5 = r5 !== null ? Math.max(0, (r5 - 2 * lim) / lim * 20) : 0;
    return Math.min(20, Math.max(p2, p5));
  };

  const out = {};
  for (const sym of STOCKS) {
    const q = Q[sym];
    if (!q || !Number.isFinite(q.price) || q.price <= 0) continue;
    const parts = [[l1For(sym), 20], [l2, 15], [l3For(sym), 25], [l4For(sym), 40]];
    let w = 0, s = 0;
    for (const [v, wt] of parts) if (Number.isFinite(v)) { w += wt; s += v * wt; }
    if (!w) continue;
    const score = Math.max(0, s / w - rsPen(sym) - ohPen(sym));
    out[sym] = { s: +score.toFixed(1), p: q.price, pct: +q.pct.toFixed(2), d: q.time.slice(0, 4) + "-" + q.time.slice(4, 6) + "-" + q.time.slice(6, 8) };
  }
  return out;
}

/* ---------- 主流程 ---------- */
const Q = await fetchQuotes([...new Set([...ALL_K, ...QUOTE_EXTRA])]);
console.log("quotes:", Object.keys(Q).length);
const K = {};
for (let i = 0; i < ALL_K.length; i += 5) {
  await Promise.all(ALL_K.slice(i, i + 5).map(async sym => { const b = await fetchK(sym); if (b) K[sym] = b; }));
  await sleep(400);
}
console.log("klines:", Object.keys(K).length);
if (!Q[HOME] || !K[HOME]) { console.error("FATAL: 主标的数据缺失，退出不提交"); process.exit(1); }

const snap = run(Q, K);
console.log("scored:", Object.keys(snap).length);

const FILE = "data/history.json";
let hist = {};
try { hist = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
for (const [sym, rec] of Object.entries(snap)) {
  const arr = hist[sym] || [];
  const entry = { d: rec.d, s: rec.s, p: rec.p, pct: rec.pct };
  if (arr.length && arr[arr.length - 1].d === rec.d) arr[arr.length - 1] = entry;
  else arr.push(entry);
  hist[sym] = arr.slice(-250);
}
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(hist));
console.log("history written:", FILE);
