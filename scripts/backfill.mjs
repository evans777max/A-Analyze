// 一次性历史回填：用与页面同口径的模型重算过去约60个交易日的收盘评分
// 记录带 bf:1 标记（回填重算），不覆盖已存在的实录快照
// 运行环境：本机（需可达 quotes.sina.cn 与 web.ifzq.gtimg.cn）；在 aa_work 根目录执行
// 已知近似：L2 仅含 纳指(T-1,内嵌静态序列,截至2026-08-06) + 恒生科技(T)，标普/日韩缺失按可用因子重加权
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const HOME = "bj920021";
const IDX_CANDS = ["sh000001", "sz399001", "sz399006", "sh000688", "sz399971", "bj899050"];
const PEERS = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*corr90: ([\d.]+)/g)]
  .map(m => ({ sym: m[1], corr90: +m[2] }));
const WATCH = [...html.matchAll(/\{ sym: "([a-z]{2}\d{6})", name: "[^"]*",\s*tag:/g)]
  .map(m => m[1]).filter(s => !IDX_CANDS.includes(s));
const STOCKS = [...new Set([HOME, ...PEERS.map(p => p.sym), ...WATCH])];
const ALL_K = [...new Set([...STOCKS, ...IDX_CANDS])];

// 纳斯达克综合收盘序列（东财 100.NDX，2026-08-07 抓取）
const US_RAW = "2026-03-16,22374.18;2026-03-17,22479.53;2026-03-18,22152.42;2026-03-19,22090.69;2026-03-20,21647.61;2026-03-23,21946.76;2026-03-24,21761.89;2026-03-25,21929.83;2026-03-26,21408.08;2026-03-27,20948.36;2026-03-30,20794.64;2026-03-31,21590.63;2026-04-01,21840.95;2026-04-02,21879.18;2026-04-06,21996.34;2026-04-07,22017.85;2026-04-08,22635.00;2026-04-09,22822.42;2026-04-10,22902.89;2026-04-13,23183.74;2026-04-14,23639.08;2026-04-15,24016.02;2026-04-16,24102.70;2026-04-17,24468.48;2026-04-20,24404.39;2026-04-21,24259.96;2026-04-22,24657.57;2026-04-23,24438.50;2026-04-24,24836.60;2026-04-27,24887.10;2026-04-28,24663.80;2026-04-29,24673.24;2026-04-30,24892.31;2026-05-01,25114.44;2026-05-04,25067.80;2026-05-05,25326.13;2026-05-06,25838.94;2026-05-07,25806.20;2026-05-08,26247.08;2026-05-11,26274.13;2026-05-12,26088.20;2026-05-13,26402.34;2026-05-14,26635.22;2026-05-15,26225.14;2026-05-18,26090.73;2026-05-19,25870.71;2026-05-20,26270.36;2026-05-21,26293.10;2026-05-22,26343.97;2026-05-26,26656.18;2026-05-27,26674.73;2026-05-28,26917.47;2026-05-29,26972.62;2026-06-01,27086.81;2026-06-02,27093.90;2026-06-03,26853.98;2026-06-04,26830.96;2026-06-05,25709.43;2026-06-08,25929.66;2026-06-09,25678.82;2026-06-10,25169.50;2026-06-11,25809.66;2026-06-12,25888.84;2026-06-15,26683.94;2026-06-16,26376.34;2026-06-17,26021.66;2026-06-18,26517.93;2026-06-22,26166.60;2026-06-23,25587.04;2026-06-24,25476.64;2026-06-25,25358.60;2026-06-26,25297.62;2026-06-29,25820.14;2026-06-30,26213.72;2026-07-01,26040.03;2026-07-02,25832.67;2026-07-06,26121.16;2026-07-07,25818.69;2026-07-08,25870.65;2026-07-09,26206.89;2026-07-10,26281.61;2026-07-13,25873.18;2026-07-14,26107.01;2026-07-15,26269.23;2026-07-16,25881.95;2026-07-17,25520.24;2026-07-20,25508.07;2026-07-21,25837.21;2026-07-22,25690.90;2026-07-23,25137.69;2026-07-24,24975.82;2026-07-27,24932.08;2026-07-28,24876.91;2026-07-29,24442.94;2026-07-30,25122.18;2026-07-31,25373.85;2026-08-03,25913.90;2026-08-04,26584.99;2026-08-05,26363.44;2026-08-06,26348.35";

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
const benchFor = sym => sym.startsWith("bj") ? "bj899050" : sym.startsWith("sh688") ? "sh000688" : sym.startsWith("sz3") ? "sz399006" : sym.startsWith("sz") ? "sz399001" : "sh000001";
const limitFor = sym => IDX_CANDS.includes(sym) ? 10 : sym.startsWith("bj") ? 30 : (sym.startsWith("sh688") || sym.startsWith("sz30")) ? 20 : 10;
const layerScore = rows => {
  const v = rows.filter(r => r && Number.isFinite(r.score));
  if (!v.length) return null;
  const w = v.reduce((s, r) => s + r.w, 0);
  return v.reduce((s, r) => s + r.score * r.w, 0) / w;
};

async function fetchSina(sym) {
  try {
    const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=90`;
    const r = await fetch(url, { ...UA, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (Array.isArray(j) && j.length > 10) return j.map(b => ({ day: b.day, high: +b.high, low: +b.low, close: +b.close, vol: +b.volume }));
  } catch (e) {}
  return null;
}

/* ---------- 拉取数据 ---------- */
const K = {};
for (let i = 0; i < ALL_K.length; i += 4) {
  await Promise.all(ALL_K.slice(i, i + 4).map(async s => { const b = await fetchSina(s); if (b) K[s] = b; }));
  await sleep(400);
}
console.log("CN klines:", Object.keys(K).length, "/", ALL_K.length);
if (!K[HOME]) { console.error("FATAL: HOME kline missing"); process.exit(1); }

// 恒生科技（腾讯 ifzq）
let HK = null;
try {
  const r = await fetch("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hkHSTECH,day,,,90,", { ...UA, signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  const d = j && j.data && j.data.hkHSTECH && j.data.hkHSTECH.day;
  if (Array.isArray(d)) HK = d.map(x => ({ day: x[0], close: +x[2] }));
} catch (e) {}
console.log("HK bars:", HK ? HK.length : 0);

/* ---------- 构建每日涨跌幅映射 ---------- */
function pctMap(bars) {
  const m = new Map();
  for (let i = 1; i < bars.length; i++) if (bars[i - 1].close) m.set(bars[i].day, (bars[i].close / bars[i - 1].close - 1) * 100);
  return m;
}
const PCT = {};
for (const s of ALL_K) if (K[s]) PCT[s] = pctMap(K[s]);
const HKP = HK ? pctMap(HK.map(x => ({ day: x.day, close: x.close }))) : new Map();
const usBars = US_RAW.split(";").map(x => { const [d, c] = x.split(","); return { day: d, close: +c }; });
const USP = pctMap(usBars);
const usDates = usBars.map(b => b.day);
function usPrevPct(d) { // CN 交易日 d 的"隔夜"美股 = 最近一个 < d 的美股交易日
  let best = null;
  for (const ud of usDates) { if (ud < d) best = ud; else break; }
  return best ? USP.get(best) ?? null : null;
}

/* ---------- 单日评分 ---------- */
const idxAt = (sym, d) => { const p = PCT[sym]; return p && p.has(d) ? p.get(d) : null; };

function scoreDay(sym, d) {
  const bars = K[sym];
  const i = bars.findIndex(b => b.day === d);
  if (i < 30) return null; // 需要足够历史（corr30+MA20）
  const upto = bars.slice(0, i + 1);
  const closes = upto.map(b => b.close);
  const p = closes[closes.length - 1];
  const myPct = PCT[sym].get(d);
  if (!Number.isFinite(myPct)) return null;
  const B = benchFor(sym), bPct = idxAt(B, d);

  // L1
  const sh = idxAt("sh000001", d), cyb = idxAt("sz399006", d);
  const spread = B === "sh000001" ? idxAt("sz399001", d) : sh;
  const l1 = layerScore([
    Number.isFinite(bPct) && { score: lin(bPct, -2, 2), w: 40 },
    B !== "sh000001" && Number.isFinite(sh) && { score: lin(sh, -1.5, 1.5), w: 25 },
    B === "sh000001" && Number.isFinite(idxAt("sz399001", d)) && { score: lin(idxAt("sz399001", d), -1.5, 1.5), w: 25 },
    B !== "sz399006" && Number.isFinite(cyb) && { score: lin(cyb, -2.5, 2.5), w: 15 },
    Number.isFinite(bPct) && Number.isFinite(spread) && { score: lin(bPct - spread, -1.5, 1.5), w: 20 }
  ].filter(Boolean));

  // L2（近似：纳指T-1 + 恒科T）
  const us = usPrevPct(d), hk = HKP.get(d);
  const l2 = layerScore([
    Number.isFinite(us) && { score: lin(us, -2, 2), w: 30 },
    Number.isFinite(hk) && { score: lin(hk, -2.5, 2.5), w: 25 }
  ].filter(Boolean));

  // L3
  let l3 = null;
  if (sym === HOME) {
    let ws = 0, ps = 0, up = 0, ok = 0;
    for (const pr of PEERS) {
      const pp = idxAt(pr.sym, d);
      if (Number.isFinite(pp)) { ws += pr.corr90; ps += pr.corr90 * pp * 10 / limitFor(pr.sym); ok++; if (pp > 0) up++; }
    }
    const rows = [];
    if (ok) rows.push({ score: lin(ps / ws, -3, 3), w: 45 }, { score: up / ok * 100, w: 15 });
    if (Number.isFinite(idxAt("sz399971", d))) rows.push({ score: lin(idxAt("sz399971", d), -2.5, 2.5), w: 20 });
    if (Number.isFinite(idxAt("sh000688", d))) rows.push({ score: lin(idxAt("sh000688", d), -2.5, 2.5), w: 20 });
    l3 = layerScore(rows);
  } else {
    const myRets = [];
    for (let k = Math.max(1, i - 29); k <= i; k++) myRets.push(upto[k].close / upto[k - 1].close - 1);
    const cands = [];
    for (const o of [...new Set([HOME, ...STOCKS, ...IDX_CANDS])]) {
      if (o === sym || !K[o]) continue;
      const ob = K[o], oi = ob.findIndex(b => b.day === d);
      if (oi < 20) continue;
      const oRets = [];
      for (let k = Math.max(1, oi - 29); k <= oi; k++) oRets.push(ob[k].close / ob[k - 1].close - 1);
      if (Math.min(myRets.length, oRets.length) < 20) continue;
      const c = corr(myRets, oRets);
      if (c !== null && c >= 0.30 && Number.isFinite(idxAt(o, d) ?? PCT[o]?.get(d))) cands.push({ sym: o, c });
    }
    cands.sort((a, b) => b.c - a.c);
    const top = cands.slice(0, 5);
    if (top.length) {
      let ws = 0, ps = 0, up = 0;
      for (const t of top) { const tp = PCT[t.sym].get(d); ws += t.c; ps += t.c * tp * 10 / limitFor(t.sym); if (tp > 0) up++; }
      l3 = layerScore([{ score: lin(ps / ws, -3, 3), w: 70 }, { score: up / top.length * 100, w: 30 }]);
    }
  }

  // L4
  const m5 = ma(closes, 5), m10 = ma(closes, 10), m20 = ma(closes, 20);
  const rows4 = [{ score: lin((p / m20 - 1) * 100, -6, 6), w: 20 }];
  let maS = 10;
  if (p > m5 && m5 > m10 && m10 > m20) maS = 100; else if (p > m5 && m5 > m10) maS = 75; else if (p > m5) maS = 55; else if (p > m20) maS = 40;
  rows4.push({ score: maS, w: 20 });
  if (Number.isFinite(bPct)) rows4.push({ score: lin(myPct - bPct, -3, 3), w: 20 });
  const bb = K[B], bi = bb ? bb.findIndex(x => x.day === d) : -1;
  if (bi >= 5 && i >= 5) {
    const rs5 = ((closes[closes.length - 1] / closes[closes.length - 6] - 1) - (bb[bi].close / bb[bi - 5].close - 1)) * 100;
    rows4.push({ score: lin(rs5, -6, 6), w: 20 });
  }
  const prev20 = upto.slice(0, -1).slice(-20);
  const h20 = Math.max(...prev20.map(b => b.high)), l20 = Math.min(...prev20.map(b => b.low));
  if (h20 > l20) rows4.push({ score: Math.max(0, Math.min(100, (p - l20) / (h20 - l20) * 100)), w: 20 });
  const vols = upto.slice(0, -1).slice(-5).map(b => b.vol);
  const avg5 = vols.length ? vols.reduce((s, x) => s + x, 0) / vols.length : null;
  if (avg5 && upto[upto.length - 1].vol) {
    const vr = upto[upto.length - 1].vol / avg5;
    rows4.push({ score: myPct >= 0 ? lin(vr, 0.6, 2.5) : 100 - lin(vr, 0.6, 2.5), w: 20 });
  }
  const l4 = layerScore(rows4);

  // 汇总 + 软规则
  const parts = [[l1, 20], [l2, 15], [l3, 25], [l4, 40]];
  let w = 0, s = 0;
  for (const [v, wt] of parts) if (Number.isFinite(v)) { w += wt; s += v * wt; }
  if (!w) return null;
  let pen = 0;
  if (Number.isFinite(bPct)) { const rs = myPct - bPct; if (rs < -1.5) pen += Math.min(15, (Math.abs(rs) - 1.5) * 10); }
  const lim = limitFor(sym);
  const r2 = i >= 2 ? (p / closes[closes.length - 3] - 1) * 100 : null;
  const r5 = i >= 5 ? (p / closes[closes.length - 6] - 1) * 100 : null;
  const p2 = r2 !== null ? Math.max(0, (r2 - 1.5 * lim) / lim * 30) : 0;
  const p5 = r5 !== null ? Math.max(0, (r5 - 2 * lim) / lim * 20) : 0;
  pen += Math.min(20, Math.max(p2, p5));
  return { d, s: +Math.max(0, s / w - pen).toFixed(1), p, pct: +myPct.toFixed(2), bf: 1 };
}

/* ---------- 主流程 ---------- */
const FILE = "data/history.json";
let hist = {};
try { hist = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
const existing = {};
for (const [sym, arr] of Object.entries(hist)) existing[sym] = new Set(arr.map(r => r.d));

const TODAY = new Date().toISOString().slice(0, 10);
let added = 0;
for (const sym of STOCKS) {
  if (!K[sym]) continue;
  const recs = [];
  for (const b of K[sym]) {
    if (b.day >= TODAY) continue; // 跳过当日（盘中数据不完整，留给收盘快照）
    if (existing[sym] && existing[sym].has(b.day)) continue; // 实录优先，不覆盖
    const r = scoreDay(sym, b.day);
    if (r) recs.push(r);
  }
  if (recs.length) {
    hist[sym] = [...(hist[sym] || []), ...recs].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-250);
    added += recs.length;
  }
}
fs.writeFileSync(FILE, JSON.stringify(hist));
console.log("backfilled records:", added);
const home = hist[HOME] || [];
console.log("HOME days:", home.length, "first:", home[0] && home[0].d, "last:", home[home.length - 1] && home[home.length - 1].d);
console.log("HOME sample:", JSON.stringify(home.slice(-6)));
