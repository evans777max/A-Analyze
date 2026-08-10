// L2 权重标签回归测试（v4.1.2）：验证标签由实际 weights.l2 驱动、与参与计算的权重一致
// 关键设计：不自建副本——从 index.html 提取①真实的 chinaMarketClock/l2Weight 函数
// ②真实的标签绑定语句，用桩 DOM 执行，保证"被测行为 = 上线行为"（非字符串存在性检查）。
// 运行：node scripts/test-l2label.mjs   （退出码 0=通过）
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
let fail = 0;
const chk = (name, cond, why = "") => { if (!cond) fail++; console.log((cond ? "PASS" : "FAIL") + "  " + name + (cond || !why ? "" : " — " + why)); };

// 1) 静态标签不得硬编码任何具体权重数字（占位符形式）
const mLabel = html.match(/<small id="l2WeightLabel"[^>]*>([^<]*)<\/small>/);
chk("label element with stable id exists", !!mLabel);
chk("static label has no hardcoded weight value", mLabel && !/权重\s*\d/.test(mLabel[1]), `static="${mLabel?.[1]}"`);

// 2) 提取真实函数与真实绑定语句
const mClock = html.match(/function chinaMarketClock\(now = new Date\(\)\) \{[\s\S]*?\n\}/);
const mL2 = html.match(/function l2Weight\(now = new Date\(\)\) \{[\s\S]*?\n\}/);
const mBind = html.match(/\$\("l2WeightLabel"\)\.textContent = [^;]+;/);
chk("page functions extractable", !!(mClock && mL2));
chk("label binding statement exists and references weights.l2", !!mBind && mBind[0].includes("weights.l2"));
if (fail) { console.log(`${fail} failed`); process.exit(1); }

// 3) 行为验证：用页面真实代码在两个模拟北京时间下执行绑定
const run = new Function("mockNow", `
  ${mClock[0]}
  ${mL2[0]}
  const el = { textContent: "" };
  const $ = () => el;
  const weights = { l1: 20, l2: l2Weight(mockNow), l3: 25, l4: 40 };
  ${mBind[0]}
  return { w: weights.l2, label: el.textContent };
`);

const CASES = [
  ["2026-08-10T01:59:00Z", 15, "北京时间 周一 09:59"],
  ["2026-08-10T02:00:00Z", 8, "北京时间 周一 10:00"],
  ["2026-08-14T01:30:00Z", 15, "北京时间 周五 09:30"],
  ["2026-08-08T03:00:00Z", 8, "北京时间 周六 11:00"],
];
for (const [iso, want, name] of CASES) {
  const r = run(new Date(iso));
  chk(`${name}: weight=${want}`, r.w === want, `got ${r.w}`);
  chk(`${name}: label="L2 · 权重${want}%"`, r.label === `L2 · 权重${want}%`, `got "${r.label}"`);
  chk(`${name}: label matches actual weight`, r.label === `L2 · 权重${r.w}%`);
}
console.log(fail ? `${fail} failed` : "all l2-label cases passed");
process.exit(fail ? 1 : 0);
