// 仓库自检（v4.1）：模型口径漂移 + 数据质量 + 版本一致性 + 隐私模式扫描
// 运行：node scripts/validate-repo.mjs   （退出码 0=全部通过，1=有 FAIL）
// 设计说明：
//  · 口径检查用"锚点正则"钉住三份模型实现中的关键行——改动任何一处而未同步会立即 FAIL。
//    这是防漂移的最低成本手段，不是等价性证明（真正的等价性需 model-core 提取 + 逐日回归，见 docs/ROADMAP.md）。
//  · 隐私扫描为启发式正则（本地绝对路径 / 常见 token 前缀 / 企业邮箱模式），能挡住明显失误，
//    不能保证捕获全部敏感信息——限制已在 docs 与复核报告中声明。
import fs from "node:fs";
import { execSync } from "node:child_process";

let pass = 0, fail = 0, skip = 0;
const ok = (name) => { pass++; console.log(`PASS  ${name}`); };
const bad = (name, why) => { fail++; console.log(`FAIL  ${name}${why ? " — " + why : ""}`); };
const skp = (name, why) => { skip++; console.log(`SKIP  ${name}${why ? " — " + why : ""}`); };
const read = p => fs.readFileSync(p, "utf8");

const idx = read("index.html");
const snap = read("scripts/snapshot.mjs");
const audit = read("scripts/audit.mjs");
const meta = JSON.parse(read("data/model-meta.json"));

/* 1. 三处模型版本声明一致，且与 model-meta 一致 */
{
  const vIdx = idx.match(/const MODEL_VERSION = "([\d.]+)"/)?.[1];
  const vSnap = snap.match(/const MODEL_VERSION = "([\d.]+)"/)?.[1];
  const vAud = audit.match(/const MODEL_VERSION = "([\d.]+)"/)?.[1];
  (vIdx && vIdx === vSnap && vIdx === vAud && vIdx === meta.currentModelVersion)
    ? ok(`model version consistent (${vIdx})`)
    : bad("model version consistency", `index=${vIdx} snapshot=${vSnap} audit=${vAud} meta=${meta.currentModelVersion}`);
}

/* 2. 主权重锚点：页面(20/L2动态/25/40)、快照(20/8/25/40)、审计(20/8/25/40) */
{
  const a = /weights = \{ l1: 20, l2: l2Weight\(\), l3: 25, l4: 40 \}/.test(idx);
  const b = /\[\[l1, 20\], \[l2, l2Weight\(\)\], \[l3, 25\], \[l4, 40\]\]/.test(idx);
  const c = /\[\[L\.l1, 20\], \[L\.l2, 8\], \[L\.l3, 25\], \[L\.l4, 40\]\]/.test(snap);
  const d = /\[\[l1,20\],\[l2,8\],\[l3,25\],\[l4,40\]\]/.test(audit);
  (a && b && c && d) ? ok("layer weight anchors (page 20/dyn/25/40 · snapshot+audit 20/8/25/40)")
    : bad("layer weight anchors", `page-main=${a} page-stock=${b} snapshot=${c} audit=${d}`);
}

/* 3. 快照收盘态 L2 权重 = 8 */
/\[L\.l2, 8\]/.test(snap) ? ok("snapshot close-state L2 weight = 8") : bad("snapshot L2 weight", "expected [L.l2, 8]");

/* 4. 页面 10:00 前 L2 权重 = 15，且按北京时间（固定 UTC+8）判定（v4.1.1；行为级验证见 scripts/test-timezone.mjs） */
{
  const anchor = /hm < 600 \? 15 : 8/.test(idx);
  const cnClock = /function chinaMarketClock/.test(idx) && /getUTCDay\(\)/.test(idx);
  const noLocalTz = !/const wd = n\.getDay\(\)/.test(idx);
  (anchor && cnClock && noLocalTz) ? ok("page l2Weight: 15 before 10:00 Beijing (fixed UTC+8), 8 after")
    : bad("page l2Weight rule", `anchor=${anchor} chinaClock=${cnClock} noLocalTz=${noLocalTz}`);
}

/* 4b. 公开版本一致性（v4.1.1）：页脚版本三元组 / README 徽章与表格 / ARCHITECTURE 均须与 model-meta 一致 */
{
  const triad = `App v${meta.appVersion} · Model v${meta.currentModelVersion} · Schema v${meta.historySchemaVersion}`;
  const footerOk = idx.includes(triad);
  const readme = read("README.md");
  const readmeOk = readme.includes(`badge/app-v${meta.appVersion}-`) && readme.includes(`| App Version | **v${meta.appVersion}** |`);
  const arch = read("docs/ARCHITECTURE.md");
  const archOk = arch.includes(`App v${meta.appVersion} `);
  const noStale = !/v3\.9/.test(idx.split("<footer>")[1]?.split("</footer>")[0] || "");
  (footerOk && readmeOk && archOk && noStale) ? ok(`public version consistency (${triad})`)
    : bad("public version consistency", `footer=${footerOk} readme=${readmeOk} arch=${archOk} noStaleFooter=${noStale}`);
}

/* 5. rsPen 不参与总分（三处） */
{
  const pageMain = /Math\.max\(0, sSum \/ wAvail - oh\.p\)/.test(idx) && !/sSum \/ wAvail - pen\.p/.test(idx);
  const pageStock = /Math\.max\(0, s \/ w - overheatPenalty\(sym\)\.p\)/.test(idx) && !/s \/ w - rsPenalty\(sym\)\.p/.test(idx);
  const snapOk = /Math\.max\(0, s \/ w - op\)/.test(snap) && !/- rsPen\(sym\)/.test(snap.split("const score")[1]?.split(";")[0] || "");
  const audOk = /score:Math\.max\(0,raw-ohPen\)/.test(audit);
  (pageMain && pageStock && snapOk && audOk) ? ok("rsPen excluded from total score (page main/stock, snapshot, audit)")
    : bad("rsPen exclusion", `pageMain=${pageMain} pageStock=${pageStock} snapshot=${snapOk} audit=${audOk}`);
}

/* 6. 过热惩罚封顶 20（三处） */
{
  const n = [idx, snap, audit].filter(t => /Math\.min\(20, ?Math\.max\(p2, ?p5\)\)/.test(t)).length;
  n === 3 ? ok("overheat penalty capped at 20 in all 3 implementations") : bad("overheat cap", `found in ${n}/3 files`);
}

/* 7-11. history.json 质量 */
let hist = null;
try { hist = JSON.parse(read("data/history.json")); ok("history.json parses"); }
catch (e) { bad("history.json parses", e.message); }
if (hist) {
  let dateErr = [], dupErr = [], rangeErr = [], typeErr = [], capErr = [], bfCount = 0, mvCount = 0;
  for (const [sym, arr] of Object.entries(hist)) {
    if (!Array.isArray(arr)) { typeErr.push(sym + ":not-array"); continue; }
    if (arr.length > 250) capErr.push(`${sym}:${arr.length}`);
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      if (i > 0 && !(arr[i - 1].d < r.d)) dateErr.push(`${sym}@${r.d}`);
      if (seen.has(r.d)) dupErr.push(`${sym}@${r.d}`); seen.add(r.d);
      if (!(Number.isFinite(r.s) && r.s >= 0 && r.s <= 100)) rangeErr.push(`${sym}@${r.d}:s=${r.s}`);
      if (!Number.isFinite(r.p) || !Number.isFinite(r.pct) || typeof r.d !== "string") typeErr.push(`${sym}@${r.d}`);
      for (const k of ["h", "l", "to", "l1", "l2", "l3", "l4", "op"]) if (k in r && !Number.isFinite(r[k])) typeErr.push(`${sym}@${r.d}:${k}`);
      if ("bf" in r) { bfCount++; if (r.bf !== 1) typeErr.push(`${sym}@${r.d}:bf=${r.bf}`); }
      if ("mv" in r) { mvCount++; if (typeof r.mv !== "string") typeErr.push(`${sym}@${r.d}:mv`); }
      if ("sv" in r && !Number.isFinite(r.sv)) typeErr.push(`${sym}@${r.d}:sv`);
    }
  }
  dateErr.length ? bad("dates ascending", dateErr.slice(0, 3).join(",")) : ok("dates strictly ascending per symbol");
  dupErr.length ? bad("no duplicate dates", dupErr.slice(0, 3).join(",")) : ok("no duplicate dates per symbol");
  rangeErr.length ? bad("scores within 0-100", rangeErr.slice(0, 3).join(",")) : ok("scores within 0-100");
  typeErr.length ? bad("field types valid", typeErr.slice(0, 3).join(",")) : ok(`field types valid (bf records preserved: ${bfCount})`);
  capErr.length ? bad("250-day cap", capErr.join(",")) : ok("250-day cap respected");

  /* 12. 新记录 mv/sv 成对且与 model-meta 一致 */
  // 规则：mv 与 sv 必须成对出现（只出现其一 = 写入 bug）；值必须匹配 model-meta；
  // 旧 v3.x 记录（两者皆无）合法，绝不为其伪造版本字段
  let mvBad = [], pairBad = [], versioned = 0;
  for (const [sym, arr] of Object.entries(hist)) for (const r of arr) {
    const hasMv = "mv" in r, hasSv = "sv" in r;
    if (hasMv !== hasSv) { pairBad.push(`${sym}@${r.d}:${hasMv ? "mv-without-sv" : "sv-without-mv"}`); continue; }
    if (!hasMv) continue; // 旧记录，合法
    versioned++;
    if (r.mv !== meta.currentModelVersion) mvBad.push(`${sym}@${r.d}:mv=${r.mv}`);
    if (r.sv !== meta.historySchemaVersion) mvBad.push(`${sym}@${r.d}:sv=${r.sv}`);
  }
  if (pairBad.length) bad("mv/sv fields paired", pairBad.slice(0, 3).join(","));
  else if (versioned === 0) skp("record mv/sv match model-meta", "no versioned records yet (expected before first v4.1 snapshot)");
  else mvBad.length ? bad("record mv/sv match model-meta", mvBad.slice(0, 3).join(",")) : ok(`record mv/sv paired & match model-meta (${versioned} versioned records)`);
}

/* 13. 私有记忆目录未被 Git 追踪（目录名动态拼接，避免本文件被 15 项引用扫描误伤） */
const PRIV_DIR = ".k" + "iro";
try {
  const tracked = execSync(`git ls-files ${PRIV_DIR}`, { encoding: "utf8" }).trim();
  tracked === "" ? ok(`${PRIV_DIR} not tracked by git`) : bad(`${PRIV_DIR} not tracked`, tracked.split("\n").length + " files still tracked");
} catch (e) { skp("private-dir tracking check", "git unavailable: " + e.message); }

/* 14+15. 公开追踪文件扫描：隐私模式（启发式）+ 私有目录引用残留（必须为零） */
try {
  const files = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n")
    .filter(f => /\.(html|md|mjs|js|json|yml|yaml|txt|css|ts)$/.test(f));
  const privRefRe = new RegExp("\\" + PRIV_DIR + "[\\\\/]"); // 匹配 目录名/ 或 目录名\
  const privHits = [];
  for (const f of files) if (privRefRe.test(read(f))) privHits.push(f);
  privHits.length ? bad("no private-dir references in tracked files", privHits.slice(0, 5).join(" | "))
    : ok(`no private-dir references in ${files.length} tracked text files`);
  const patterns = [
    [/[A-Za-z]:[\\/](Users|Ev)[\\/]/, "windows local path"],
    [/\/(home|Users)\/[a-z0-9_]+\//, "unix home path"],
    [/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/, "github token"],
    [/xox[bp]-[A-Za-z0-9-]+/, "slack token"],
    [/AKIA[0-9A-Z]{16}/, "aws key id"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/[a-zA-Z0-9._%+-]+@(amazon|corp)\.[a-z]+/, "corporate email"]
  ];
  const hits = [];
  for (const f of files) {
    const t = read(f);
    for (const [re, label] of patterns) if (re.test(t)) hits.push(`${f}: ${label}`);
  }
  hits.length ? bad("no sensitive patterns in tracked files", hits.slice(0, 5).join(" | "))
    : ok(`no sensitive patterns in ${files.length} tracked text files (heuristic scan)`);
} catch (e) { skp("sensitive pattern scan", "git unavailable: " + e.message); }

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
