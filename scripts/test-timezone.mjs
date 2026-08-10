// 时区回归测试（v4.1.1）：验证 L2 时变权重按北京时间（固定 UTC+8）判定，与访问者时区无关
// 关键设计：不自建副本——直接从 index.html 提取页面真实的 chinaMarketClock/l2Weight 源码执行，
// 保证"被测逻辑 = 上线逻辑"。在 CI 中以 TZ=UTC / America/New_York / Asia/Shanghai 各跑一遍，结果必须一致。
// 运行：node scripts/test-timezone.mjs   （退出码 0=通过）
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");
const mClock = html.match(/function chinaMarketClock\(now = new Date\(\)\) \{[\s\S]*?\n\}/);
const mL2 = html.match(/function l2Weight\(now = new Date\(\)\) \{[\s\S]*?\n\}/);
if (!mClock || !mL2) {
  console.log("FAIL  cannot extract chinaMarketClock/l2Weight from index.html (page implementation changed?)");
  process.exit(1);
}
const l2Weight = new Function(mClock[0] + "\n" + mL2[0] + "\nreturn l2Weight;")();

const CASES = [
  // [UTC 时刻, 期望权重, 说明]
  ["2026-08-10T01:59:00Z", 15, "北京时间 周一 09:59 → 15"],
  ["2026-08-10T02:00:00Z", 8, "北京时间 周一 10:00 → 8"],
  ["2026-08-08T01:00:00Z", 8, "北京时间 周六 09:00 → 8"],
  ["2026-08-09T05:00:00Z", 8, "北京时间 周日 13:00 → 8"],
  ["2026-08-14T01:30:00Z", 15, "北京时间 周五 09:30 → 15"],
  ["2026-08-10T15:00:00Z", 8, "北京时间 周一 23:00 → 8"],
  ["2026-08-09T16:30:00Z", 15, "北京时间 周一 00:30（跨日边界）→ 15"],
];

let fail = 0;
console.log(`TZ=${process.env.TZ || "(system default)"}`);
for (const [iso, want, label] of CASES) {
  const got = l2Weight(new Date(iso));
  const okFlag = got === want;
  if (!okFlag) fail++;
  console.log(`${okFlag ? "PASS" : "FAIL"}  ${iso} ${label}  got=${got}`);
}
console.log(fail ? `${fail} case(s) failed` : "all timezone cases passed");
process.exit(fail ? 1 : 0);
