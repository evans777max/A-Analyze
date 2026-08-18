// 盘中/盘后快讯采集与异动归因对齐（v1.0，2026-08-18）
//
// 用途：给"某个时点为什么放量拉升/跳水"提供**带秒级时间戳的证据**。
//   纯价量数据只能回答"谁在动"，回答"为什么在这一分钟动"必须有时间戳对齐的快讯流。
//   2026-08-18 实例：拓维/软通/众诚在 13:51 与 14:06-14:14 两波爆量，
//   与同花顺快讯 13:52:01「国产操作系统板块短线拉升，诚迈科技涨超9%」、
//   14:07:34「国产操作系统持续走高，中国软件触及涨停」逐分钟吻合 —— 由此定位真实题材为
//   国产操作系统（信创），而非此前误判的"华为链"。方法论见 memory/A股规律观察.md O9。
//
// 用法：
//   node scripts/newsfeed.mjs                        当日全部快讯（按时间倒序）
//   node scripts/newsfeed.mjs --kw 操作系统,半导体      仅关键词命中
//   node scripts/newsfeed.mjs --at 13:51 --win 10     对齐某时点±10分钟（异动归因）
//   node scripts/newsfeed.mjs --json                 输出 JSON 供脚本消费
//
// 数据源可达性实测（2026-08-18，本机 + Node fetch）：
//   ✅ 同花顺 news.10jqka.com.cn  —— 秒级 ctime 时间戳，最适合做时点对齐，首选
//   ✅ 华尔街见闻 api-one-wscn.awtmt.com —— 可用，但部分条目 title 为空（正文在 content_text）
//   ❌ 财联社 cls.cn/nodeapi/telegraphList —— HTTP 404
//   ❌ 东财快讯 np-listapi.eastmoney.com —— 返回 87 字节空壳
// 注：与 snapshot.mjs 的 fetchGlobal 一样加重试；任一源失败不阻断，只在结尾汇报缺失。

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const has = name => argv.includes("--" + name);

const KW = (arg("kw") || "").split(",").map(s => s.trim()).filter(Boolean);
const AT = arg("at");                     // "HH:MM"
const WIN = +(arg("win") || 10);          // 分钟
const AS_JSON = has("json");

// 北京时间口径：容器/本机 TZ 可能不是 UTC+8，故统一按 UTC+8 换算
const bj = ms => new Date(ms + 8 * 3600 * 1000);
const hhmmss = ms => bj(ms).toISOString().slice(11, 19);
const ymd = ms => bj(ms).toISOString().slice(0, 10);

async function retry(fn, label, n = 3) {
  for (let i = 1; i <= n; i++) {
    try { return await fn(); }
    catch (e) {
      console.error(`  ${label} attempt ${i}/${n} failed: ${e.message}`);
      if (i < n) await sleep(i * 1200);
    }
  }
  return null;
}

// 同花顺：ctime 为秒级 Unix 时间戳
async function fetchThs(pagesize = 100) {
  return retry(async () => {
    const url = `https://news.10jqka.com.cn/tapp/news/push/stock/?page=1&tag=&track=website&pagesize=${pagesize}`;
    const r = await fetch(url, { ...UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const list = j?.data?.list || j?.list || [];
    if (!list.length) throw new Error("empty list");
    return list.map(x => ({
      src: "同花顺", ms: +x.ctime * 1000,
      title: (x.title || "").trim(),
      url: x.url || x.appurl || ""
    })).filter(x => Number.isFinite(x.ms) && x.title);
  }, "ths");
}

// 华尔街见闻：display_time 秒级；部分条目无 title，回落到正文首句
async function fetchWscn(limit = 100) {
  return retry(async () => {
    const url = `https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&client=pc&limit=${limit}`;
    const r = await fetch(url, { ...UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const items = j?.data?.items || [];
    if (!items.length) throw new Error("empty items");
    return items.map(x => {
      let t = (x.title || "").trim();
      if (!t) {
        const body = (x.content_text || x.content_short || x.content || "").replace(/<[^>]+>/g, " ").trim();
        t = body.split(/[。\n]/)[0].slice(0, 90);
      }
      return { src: "见闻", ms: (x.display_time || x.created_at) * 1000, title: t, url: x.uri || "" };
    }).filter(x => Number.isFinite(x.ms) && x.title);
  }, "wscn");
}

/* ---------- 主流程 ---------- */
const [ths, wscn] = await Promise.all([fetchThs(), fetchWscn()]);
const miss = [];
if (!ths) miss.push("同花顺");
if (!wscn) miss.push("见闻");

let all = [...(ths || []), ...(wscn || [])];
if (!all.length) {
  console.error("FATAL: 全部快讯源不可用，无法产出");
  process.exit(1);
}

// 去重：同一分钟 + 标题前 20 字相同视为重复（两源常转同一条）
const seen = new Set();
all = all.filter(x => {
  const k = hhmmss(x.ms).slice(0, 5) + "|" + x.title.slice(0, 20);
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

const today = ymd(Date.now());
all = all.filter(x => ymd(x.ms) === today).sort((a, b) => b.ms - a.ms);

// 时点对齐模式
let picked = all, mode = `当日全部（${today}）`;
if (AT) {
  const [h, m] = AT.split(":").map(Number);
  const target = h * 60 + m;
  picked = all.filter(x => {
    const t = bj(x.ms);
    const mm = t.getUTCHours() * 60 + t.getUTCMinutes();
    return Math.abs(mm - target) <= WIN;
  });
  mode = `${AT} ±${WIN}分钟`;
}
if (KW.length) {
  picked = picked.filter(x => KW.some(k => x.title.includes(k)));
  mode += ` · 关键词[${KW.join("/")}]`;
}

if (AS_JSON) {
  console.log(JSON.stringify({
    date: today, mode, missing: miss,
    items: picked.map(x => ({ t: hhmmss(x.ms), src: x.src, title: x.title, url: x.url }))
  }, null, 1));
} else {
  console.log(`快讯 · ${mode} · 命中 ${picked.length} / 当日 ${all.length} 条`);
  if (miss.length) console.log(`⚠ 源缺失: ${miss.join(",")}（结论据此打折）`);
  console.log("");
  for (const x of picked.sort((a, b) => a.ms - b.ms)) {
    console.log(`  [${hhmmss(x.ms)}] (${x.src}) ${x.title}`);
  }
}
