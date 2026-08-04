# A-Analyze

![Live](https://img.shields.io/badge/Live-edgeone.cool-46d39a?style=flat-square)
![Version](https://img.shields.io/badge/version-v2.3-102a43?style=flat-square)
![Single File](https://img.shields.io/badge/single--file-index.html-blue?style=flat-square)
![Zero Deps](https://img.shields.io/badge/dependencies-0-success?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS%2FCSS-f7df1e?style=flat-square)
![Market](https://img.shields.io/badge/market-A%E8%82%A1%20%C2%B7%20%E5%8C%97%E4%BA%A4%E6%89%80-d92d20?style=flat-square)
![Deploy](https://img.shields.io/badge/deploy-EdgeOne%20Pages-102a43?style=flat-square)

单文件、零依赖的 A 股多因子实时分析页。当前标的：流金科技（920021 · 北交所）。

**Live**: https://liujin-live-2.edgeone.cool/

## 它做什么

不只是行情展示。页面内置一个透明的四层因子评分模型，输出 0-100 综合评分、明确的仓位档位建议和条件式交易剧本：

| 层 | 权重 | 因子 |
|---|---|---|
| L1 市场环境 | 20% | 上证 / 创业板 / 北证50 实时涨跌，北证-上证相对强弱价差 |
| L2 全球情绪 | 15% | 隔夜美股三大指数，恒生科技（盘中），日经225 / 韩国KOSPI |
| L3 板块联动 | 25% | 数据筛选的 5 只高相关标的（ρ加权组合）+ 中证传媒 + 科创50 |
| L4 个股动能 | 40% | 均线结构，vs北证50 相对强弱，20日区间位置，量比，价格vs MA20 |

评分映射到四档仓位：进攻 60–80% / 积极持有 40–60% / 观望 20–40% / 防守 0–20%。
两条硬规则优先于分数：跌破趋势防线强制防守档；北证50 单日大跌禁止进攻档。

关键价格带默认自动推导（60日高 / 20日前高 / MA10-20 / 20日低 + ATR 去重），
可在 `index.html` 顶部 `CONFIG.MANUAL_LEVELS` 手工覆盖。

## 关联票与自选票

- `PEERS`（参与 L3 评分）：用 90 日收益率相关性离线筛选得出——数码视讯 0.64、华数传媒 0.49、优刻得 0.48、中国卫通 0.34、云赛智联 0.33。页面另实时计算 30 日滚动相关性作对照。
- `WATCHLIST`（不参与主标的 L3 评分，但每只票有同口径实时评分：L1/L2 共享市场层，L3 按 30 日实际联动在全池内自动匹配篮子，L4 逐票计算、基准按所属板块适配）：20 只 AI / 云计算 / 数据中心 / 芯片主题池——北交AI（众诚科技、汉鑫科技）、AI芯片（寒武纪、海光信息、中芯国际、澜起科技、北方华创）、算力服务器（中科曙光、浪潮信息、工业富联）、IDC（数据港、润泽科技、光环新网）、光模块（中际旭创、新易盛）、AI应用（科大讯飞、金山办公、昆仑万维）、华为链（拓维信息、软通动力）。按涨跌幅实时排序。

两个数组都在 `index.html` 配置区，直接编辑即可增删。

## 数据源与架构

纯静态单文件，无构建、无后端、无密钥。浏览器端直连三个公开行情源：

- 腾讯 `qt.gtimg.cn`：实时报价（10 秒刷新）
- 新浪 `quotes.sina.cn`：90 天日K（10 分钟刷新，含北交所）
- 东方财富 `push2.eastmoney.com`：日经 / KOSPI（60 秒刷新，不可达时自动降级重加权）

任一数据源失效不影响其余因子，评分自动按可用因子重新加权，页面底部有数据源健康状态。

## 部署

EdgeOne Pages Git 集成：推送到 `main` 分支即自动部署。改动 `index.html` → commit → push，约 1-2 分钟后线上生效。

## 免责声明

综合评分为公开行情驱动的规则化模型输出，非投资顾问服务；仓位档位仅为该标的计划资金内的参考区间，不构成投资建议。行情数据可能存在延迟。投资有风险，决策需独立判断。
