# 2026-08-26 · 跨页面时间模块审计（P1 第一步，只读）

## 审计范围

按 `OPENCODE_HANDOFF.md` P1"统一跨页面时间模块"要求，梳理全部页面的时间路径与合同现状。本轮只审计不改代码。

## 各页面时间合同现状

### 1. index.html / app.js（主太阳系页面）

- 输入：民用 UTC/CST → `civilToJd` → UTC JD → `deltaTSecondsForJd`（NASA/Espenak 分段多项式，覆盖 -500 以前至 2150 以后）→ TT JD。
- 内部：全局 `jd` 为 TT JD；行星、月球、三体、内嵌模式（历史剧场 `__hist`、发射场 `__lnch`、阿波罗 `__apollo`、任务链）全部消费同一 TT 时间线（如 `app.js:5105` 的 `sc.jd`）。
- 输出：`ttJdToUtcJd` 两次迭代反解。
- 状态：合同完整，已通过 2026-08-26 回归验证。

### 2. sky.html / sky.js（地面观星）

- 输入：`jdFromUnixMs(Date.now())`（UTC JD）或深链 `#jd=`（主页面 `ttJdToUtcJd` 转换后传入，已端到端验证）。
- 内部：`state.jd` 全程 UT 语义；GMST/LST 用 UT；`jdTT(jdUt)` 用页面自带的 `deltaTSec` 转 TT，供行星/月球 of-date RA/Dec 使用（`sky.js:96`、`sky.js:187`）。
- 状态：输入/输出合同正确，但 ΔT 是第二套实现。

### 3. moon.html / moon.js（月面）

- 无时间系统：主页面 iframe 打开 `moon.html` 不带任何时间参数（`app.js:5133`）；页面自身无儒略日、无 ΔT。
- 太阳方向为硬编码静态值 `SUN_DIR = (-1400, 700, 900)` 归一化（`moon.js:179`），不随时间变化；星空为静态星表。
- 与页面文案"真实方位的地球/和主页同一套数据"存在边界模糊：几何方位有依据，但光照时刻不是任何可查询的历元。

### 4. launch_site.html（发射场）

- 纯 `model-viewer` 静态 GLB 查看器，无任何天文时间依赖（仅 `setTimeout` 加载超时保护）。
- 合同可声明为"无天文时间依赖"。

## 发现的问题

### A. ΔT 双实现且深时不一致（主要问题）

- `app.js:7395`：NASA/Espenak 全历史分段多项式（-500 前抛物线、分世纪多项式、2005-2050 抛物线、2150 后抛物线）。
- `sky.js:27`：仅 2005-2050 段抛物线 `62.92 + 0.32217t + 0.005589t²`（t 为距 2000 年的年数），注释承认"邻域外平滑延用"。
- 两套实现系数相同，因此 2005-2050 内数值一致；范围外（如深链 2100 年观星）sky.js 继续抛物线而 app.js 切换分段，ΔT 偏差可达秒级，直接进入 sky.js 的 of-date 天体位置。
- 影响：观星页面主要用于"现在"，实际风险低；但违反"所有页面统一走同一转换函数"的目标。

### B. 月面页面无时间合同

- 不接收时间、太阳方向固定。若宣传"实时"，需接入真实时刻太阳黄经；否则应明确标注为固定摆景。

### C. 发射场页面无时间依赖

- 无问题，仅需文档声明。

## 统一方案建议（待确认后实施）

1. 新增零依赖公共模块 `ephemeris-time.js`（挂 `window.EPHEMERIS_TIME`），迁移 app.js 的全套时间函数：`civilToJd`、`jdToCivil`、`deltaTSecondsForYear`、`deltaTSecondsForJd`、`utcJdToTtJd`、`ttJdToUtcJd`、`parseDateToTtJd`、`jdFromUnixMs`。
2. `index.html`、`sky.html` 在业务脚本前加载该模块；app.js 删除本地重复定义改为解构引用；sky.js 删除 `deltaTSec/jdTT` 本地实现改用公共 `deltaTSecondsForJd`。
3. `moon.html`：短期在页面与 README 标注"固定时刻摆景，非实时光照"；中期可接收 `#jd=UTC JD` 深链计算真实太阳方向（复用公共模块）。
4. `launch_site.html`：README 标注无时间依赖。
5. 跨页面跳转回归：index→sky（已验证）；index→moon（若接入 jd）；每次改动后在控制台跑 J2000/日食/当前时刻三组锚点。
6. `sw.js` 缓存版本与 `index.html` 的 `VER` 需同步递增，避免旧缓存。

## 风险与边界

- app.js 是 8412 行核心文件，替换函数定义需逐锚点回归（J2000、2024 日食、当前时刻、-199 年）。
- sky.js 改动在 2005-2050 内数值零变化（系数一致），范围外才会变化，属行为修正而非破坏。
- 本轮未修改任何代码；实施需用户确认。

## 实施记录（2026-08-26，用户确认后执行）

### 改动清单

- 新增 `ephemeris-time.js`：零依赖公共时间模块，挂 `window.EPHEMERIS_TIME`（非浏览器环境挂 `globalThis`）。迁移 app.js 全套函数：`civilToJd`、`jdToCivil`、`deltaTSecondsForYear`、`deltaTSecondsForJd`、`utcJdToTtJd`、`ttJdToUtcJd`、`currentUtcJd`、`currentTtJd`、`parseDateToTtJd`、`jdFromUnixMs`、`unixMsFromJd` 及历法辅助（`usesGregorianCalendar`、`isLeapCivilYear`、`daysInCivilMonth`、`GREGORIAN_SWITCH_JD`）。
- `app.js`：IIFE 顶部解构 `window.EPHEMERIS_TIME`（模块缺失时抛出明确错误）；删除本地重复定义约 150 行；`calendarMode`/`timeZoneOffsetHours` 依赖页面控件，保留本文件。
- `sky.js`：`deltaTSec` 改为优先引用公共 `deltaTSecondsForJd`，模块缺失（node VM 直载引擎场景）时降级为原 2005-2050 单段近似；`jdFromUnixMs`/`unixMsFromJd` 同模式；`jdTT`、`window.__sky` 导出名不变。
- `index.html`：在 vendor 后、业务脚本前加载 `./ephemeris-time.js?v=64`。
- `sky.html`：在 `sky.js` 前加载 `ephemeris-time.js?v=64`。
- `sw.js`：`VER` v64 → v65，预缓存清单加入 `./ephemeris-time.js?v=64`。
- `moon.js`：引导文案追加边界说明（固定时刻摆景、非实时天象）。
- `README.md` / `README.en.md`：新增"时间合同与页面边界"章节（含 launch_site 无时间依赖声明）。

### 回归验证（全部通过）

- `node --check` app.js / sky.js / sw.js / ephemeris-time.js / moon.js：通过；`git diff --check`：通过。
- 清除 SW 与全部缓存后新开页面（端口 4185）：
  - `window.EPHEMERIS_TIME` 加载成功，控制台零错误。
  - J2000：`parseDateToTtJd("2000-01-01T12:00",0)` = `2451545.0007392806`；三体两条残差机器精度。
  - 2024 日食：UTC/CST 同历元 `2460409.3341903244`（与迁移前逐位一致）。
  - 公元前 199 年：TT JD `1648374.1479`，往返恢复 `-199-01-01`（分段多项式迁移无损）。
- `sky.html` 深链：`sky.deltaTSec` 与主页面 `deltaTSecondsForJd` 逐位一致（2026 时刻 ΔT=75.511 s）；深时行为修正生效（2100 年 ΔT 由旧实现的约 151 s 修正为 Espenak 分段的 80.4 s）；恒星时/月相/日月角距渲染正常，零控制台错误。
- `sh package-source.sh`：ZIP 生成，根目录含 `index.html` 与 `ephemeris-time.js`。

### 遗留

- moon.html 接入 `#jd=` 真实太阳方向（中期项）。
- 跨页面时间转换回归目前为浏览器控制台手工锚点；后续如需免浏览器回归可再评估。
