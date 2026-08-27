# DE440 高精度历表集成 — 代码审查报告

> 审查日期：2026-08-27
> 审查范围：`ephemeris-time.js`(新建) / `spk-parser.js`(重写) / `spk-coord.js`(新建) / `spk-loader.js`(重写) / `app.js`(threeBodyStateKm·updateSystem) / `sw.js`(v67)
> 审查方式：源码逐行 + `de440s_compact.bin` 二进制头实测

---

## 一、结论总览

| 文件 | 结论 |
|------|------|
| ephemeris-time.js | 算法正确（Espenak 标准多项式），与描述有出入 |
| spk-parser.js | 样条/二分/格式解析正确；Type-2 SPK 回退是空实现 |
| spk-coord.js | 旋转矩阵正确；ε_A 注释标错年代 |
| spk-loader.js | **有坐标正确性 bug（moonGeo 语义 + earth 缺因子）** |
| app.js | **SPK 月球位置被覆盖未生效；降级不彻底；日月食未接 SPK** |
| sw.js | **版本号与 index.html 不一致，离线缓存 miss** |

**核心判断**：时间模块统一（P1-1）质量高、可直接验收；但 DE440 集成（P1-2）只**真正提升了地球(EMB)的渲染位置**，月球、行星、日月食判定均未实际使用 SPK，且存在 1 个离线缓存失效的 P0 问题和 2 个坐标正确性问题。

---

## 二、逐文件审查

### 1. ephemeris-time.js（新建）— ✅ 基本合格

- 民用历 ↔ JD 转换（`civilToJd`/`jdToCivil`）实现正确，含儒略/格里高利切换（1582-10-15）与 `jdToCivil` 的 round-trip 分钟归一化。
- ΔT 采用 **NASA/Espenak 分段多项式**（`deltaTSecondsForYear`），系数与标准一致（-500~2050 各分段系数核对无误）。
- `deltaTSecondsForJd` 用 `year + (month-0.5)/12` 分数年线性定位，符合 Espenak 原表用法。
- `ttJdToUtcJd` 一次迭代修正，ΔT 慢变，足够。
- `parseDateToTtJd` 正则仅支持到分钟、两位数字，并做 round-trip 校验兜底，与项目「YYYY-MM-DD HH:00」约定一致。

**问题（P2）**：
- 变更概述称「USNO 简表 + 二次插值」，实际是 **Espenak 多项式**。实现本身更常用、更准，仅描述与实际不符，改描述即可。

### 2. spk-parser.js（重写）— ✅ 核心正确，回退为空壳

- `buildCubicSpline`：标准 natural cubic spline（三对角 Thomas 算法），系数 `b/c/d` 推导正确。
- `splineEval`：二分查找定位区间 + Horner 求值，位置/速度（对 JD 一阶导）正确；边界外推虽存在，但上层 `_getBodyState` 已做 `jd < jds[0] || jd > jds[n-1]` 守卫，实际不触发。
- `parseCompactFormat`：header 布局（28B）与数据体解析正确。实测 magic=`0x44453434` ✓，nBodies=12，offset 逐体推进 4.509 MB 与文件大小完全吻合 ✓。
- **速度单位转换正确**：样条对 JD（天）求导 → km/day，`result[3..5] /= 86400` → km/s ✓。

**实测数据**（`de440s_compact.bin`）：

| 天体 | NAIF | nEpochs | 步长 | 首 epoch 坐标量级 (km) |
|------|------|---------|------|------------------------|
| sun | 10 | 15658 | 7d | 2.2e5 |
| mercury~pluto | 1-9 | 15658 | 7d | 5.6e7 ~ 6.0e9 |
| emb | 3 | 15658 | 7d | 1.34e8 |
| moon | 301 | 109601 | 1d | **1.34e8（绝对 SSB）** |
| earth | 399 | 109601 | 1d | **1.34e8（绝对 SSB）** |

- 覆盖 **1850~2150（±150 年）**，跨度 109600 天。
- 行星 7 天步长、月球/地球 1 天步长，均为整数天，`int32 stepDays` 当前数据安全。

**问题**：
- **P2**：`_loadSPK` / `_getStateSPK` 是空实现（`segments:[]`、恒返回 null），却标注「兼容保留 Type 2 Chebyshev」。一旦 compact magic 不匹配回退到 SPK 路径，将「假成功但永远查不到数据」。
- **P2**：header 字段名 `jd_start_ms` / `jd_end_ms` 误导——实为 JD×1000 的 int64，非毫秒时间戳。
- **P2**：`stepDays` 用 int32，隐含「只能整数天步长」的限制，格式本身无此说明。
- **精度隐患（P1，见要点 2）**：月球/地球存**绝对 SSB 坐标**（~1.34e8 km），float32 ULP ≈ 16 km，差分后月-地距离量化误差 ~22 km RMS。

### 3. spk-coord.js（新建）— ✅ 旋转正确，注释年代错误

- ICRF 赤道 → J2000 黄道：绕 X 轴旋转 ε_A，`y'=y·cosε+z·sinε`、`z'=-y·sinε+z·cosε`，方向与标准 R_x(ε) 一致 ✓。速度用同一旋转矩阵 ✓（该变换不随时间变化，无科里奥利项）。
- SSB→日心减法正确。

**问题（P2）**：`OBLIQUITY_J2000 = 23.439291111°` 是 **IAU 1976** 平黄赤交角（84381.448″）。注释标「IAU 2000」，而 IAU 2000 值为 23.439279444°（84381.406″）。差 0.042″≈2e-7 rad，海王星处误差 ~900 km，可视化可忽略——**仅注释与数值不匹配，改注释即可**。

### 4. spk-loader.js（重写）— ⚠️ 有坐标正确性 bug

`getState(jd)` 是核心，逐行问题：

```js
const moonGeoRaw = _parser.getState(301, 3, jdTt);   // = moon − emb（月球相对 EMB）
const moonGeoEcl = SPK_COORD.icrfToEcliptic(moonGeoRaw.slice(0,3));
const moon = emb + moonGeoEcl;                        // ✓ 月球位置正确
const moonGeo = moonGeoEcl;                           // ✗ 语义错：赋成了 moon−emb
const earth = emb − moonGeoEcl * MU_MOON;             // ✗ 缺 1/(1−MU_MOON) 因子
```

**P1-坐标正确性**：
1. **moonGeo 语义不一致**：降级路径约定 `moonGeo = moon − earth`（约 384400 km）；SPK 路径返回 `moon − emb`（约 379726 km），**差 4670 km**。`threeBodyResidualKm` 在 SPK 下因此报非零残留（`moonMinusEarth ≈ 4670 km`），契约被破坏。
2. **earth 计算缺因子**：由质量定义 EMB = earth·(1−μ) + moon·μ（μ=MU_MOON），可得
   `earth = emb − (moon−emb)·μ/(1−μ)`。代码漏了 `/（1−μ）`，误差 = `|moon−emb|·μ²/(1−μ) ≈ 57 km`。
   57 km 约地球半径 0.9%，真实尺度下聚焦地球时有轻微可见偏移。

**修复建议（最简）**：compact 格式同时存了 301/399/3 三者的绝对坐标，无需质量比反推：
```js
const earthState = getStateHeliocentric(399, 0, jdTt);  // 地球质心，日心黄道
const moonState  = getStateHeliocentric(301, 0, jdTt);  // 月球质心，日心黄道
const emb        = getStateHeliocentric(3,   0, jdTt);
return { jdTt, sun:[0,0,0], emb, earth:earthState.slice(0,3),
         moon:moonState.slice(0,3), moonGeo:[moon−earth] };
```
这样 moonGeo 语义与降级路径完全一致，且 earth/emb/moon 全部直接来自 DE440。

**其他问题**：
- **P1**：`_loadBuffer` 中 `_available = true` 无条件设置。若文件损坏（magic 不匹配），`parser.load` 回退到空 `_loadSPK`，`isAvailable()` 返回 true、状态显示「DE440 模式」，但 `getState` 恒 null。降级「假成功」。
- **P2**：`getStateHeliocentric(targetId, centerId, jd)` 的 `centerId` 是死参数（内部硬编码 `getState(targetId, 0, ...)`），签名误导。

### 5. app.js（修改）— ⚠️ 集成不完整

**5.1 `updateSystem`（2511 行起）SPK 月球位置被覆盖（P1）**

顺序：
```
2522  moonGeoKm(jd, _mg)                       // Meeus 月球
2527  if (SPK 可用) { eW=spk.earth; worldKm.Moon=spk.moon; baryOff=... }
2545  for (sat of SATELLITES)
2550    if (sat.name==="Moon") wS = p + _mg;    // ← 用 Meeus 覆盖了 worldKm.Moon
```

第 2550 行 `wS = worldKm.Earth + _mg` 把 2531 行刚写入的 `worldKm.Moon = spk.moon` **覆盖回 Meeus 结果**。结论：**SPK 的月球高精度位置从未进入渲染**，月球仍由 Meeus 历表驱动（Meeus 本身 ~10″ 精度，够用，但意味着集成白做了）。

**5.2 `threeBodyStateKm`（7447 行）降级不彻底（P1）**

```js
if (SPK_LOADER && isAvailable()) {
  return SPK_LOADER.getState(jdTt);   // 超范围时返回 null，不 fall through
}
```
SPK 覆盖 ±150 年，而页面允许 ±5 万年（DEEP_TIME_DAYS=18262500）。深时模式下 `getState` 返回 null，`threeBodyStateKm` 直接 return null，**未降级到近似模型**。主渲染走 `updateSystem`（有 `if(_spk)` 保护）不受影响，但 `__ephemeris.threeBodyResidualKm` 等调试接口会拿到 null。应改为「SPK 返回非 null 才 return，否则继续降级」。

**5.3 日月食引擎未接 SPK（P1，目标落差）**

`eclState`（2908 行）仍用 `heliocentricKm(Earth.orbit_j2000)` + `moonGeoKm`（Meeus），`scanAstroEvents`（3029 起）整条日月食链从未调用 SPK。而变更概述的动机是「近似轨道精度 ~1° 不足以支撑日月食」——但实际上日月食一直由 Meeus 月球历表驱动（精度 ~10″，本就够用），并非 threeBodyStateKm 的近似轨道。因此：

- 「DE440 支撑日月食」这一目标**实际未落地**；
- 若未来把日月食切到 SPK 的 `moonGeo`，会立刻踩中 spk-loader 的 moonGeo 语义 bug（4670 km 偏移 > 月食本影半径 4600 km，判定直接错乱）。

### 6. sw.js（v67）— ⚠️ P0 版本号不一致

- 缓存策略本身正确：install 全量预缓存 + `no-cache` 抓最新；activate 清理 `rt-solar-*` 且 `!= CACHE_NAME` 的旧缓存（旧版本会清）✓；fetch 缓存优先 + stale-while-revalidate ✓。
- **P0**：`PRECACHE` 中 spk 三件套写 `?v=67`，但 `index.html` 实际引用 `?v=66`：

| 文件 | index.html | sw.js PRECACHE |
|------|-----------|----------------|
| spk-parser.js | v66 | **v67** |
| spk-coord.js | v66 | **v67** |
| spk-loader.js | v66 | **v67** |
| app.js / ephemeris-time.js | v64 | v64 ✓ |

非 navigate 请求 `cache.match(req, {ignoreSearch:false})` 按完整 URL 精确匹配，v66 请求命中不到 v67 缓存条目。后果：**离线时 spk 三件套 503 兜底，DE440 失效**（功能降级到近似模型不崩，但违背「完全离线 + 高精度」卖点）。且 v67 三件套成为死缓存。修复：统一为 v67（或统一 bump app.js/ephemeris-time.js 版本号）。

---

## 三、按审查要点回答

**1. 坐标正确性** — 旋转方向与矩阵正确；ε_A 数值（IAU 1976）可用但注释标错年代（P2）。真问题在 spk-loader 的 moonGeo/earth（P1）。

**2. 数值精度** — float32 对渲染够用（海王星 ULP 536 km，场景 1BU=1000 km 无感）；但月球/地球存绝对 SSB 坐标，月-地差分量化误差 ~22 km（对比差分存储仅 ~45 m），对月食本影（4600 km）判定可接受但无余量。三次样条实现正确，速度单位转换正确。

**3. 降级策略** — 三处不健壮：`threeBodyStateKm` 超范围不降级（P1）；`_loadBuffer` 损坏文件假成功（P1）；`_loadSPK` 空实现伪兼容（P2）。建议统一为「SPK 返回 null 即走近似模型」。

**4. 性能** — 每帧约 4 次样条求值 × 3 轴 × 二分(log2(109601)≈17)，开销可忽略。可优化点：splineEval 二分未利用帧间 jd 单调性（可选）；加载期 `parseCompactFormat` 的样条构建一次性 ~百 ms 可接受。

**5. SW 缓存** — 策略正确，旧缓存会清理；但版本号不一致导致离线缓存 miss（P0）。

**6. 代码质量** — 模块化/命名总体清晰，`SPK_COORD`/`SPKParser`/`SPK_LOADER` 分层合理。扣分项：`centerId` 死参数、`jd_*_ms` 命名误导、`_loadSPK` 空实现伪兼容、版本号体系不统一（ephemeris 用 v64、spk 用 v67、且 html 与 sw 不一致）。

---

## 四、问题清单（按优先级）

| 级别 | # | 位置 | 问题 | 影响 |
|------|---|------|------|------|
| **P0** | 1 | sw.js / index.html | spk-*.js 版本号 v67 vs v66 不一致 | 离线时 DE440 失效 |
| **P1** | 2 | spk-loader.js getState | moonGeo 语义错（moon−emb vs moon−earth，差 4670km）+ earth 缺 1/(1−μ) 因子（偏 57km） | 契约破坏，未来日月食接入即错乱 |
| **P1** | 3 | app.js updateSystem:2550 | SPK 月球位置被 SATELLITES 循环 Meeus 覆盖 | 月球高精度未生效 |
| **P1** | 4 | app.js threeBodyStateKm:7450 | SPK 超范围返回 null 不降级 | 深时模式调试接口失效 |
| **P1** | 5 | spk-loader.js _loadBuffer | 损坏文件假成功（isAvailable=true 但无数据） | 状态误导 |
| **P1** | 6 | app.js eclState:2908 | 日月食引擎未接 SPK，仍用 Meeus | 变更目标未落地 |
| **P1** | 7 | spk-parser/生成脚本 | 月球/地球 float32 绝对坐标，精度浪费 | 月食判定余量不足 |
| **P2** | 8 | spk-coord.js | ε_A 注释「IAU 2000」实为 1976 值 | 注释误导 |
| **P2** | 9 | ephemeris-time.js | ΔT「USNO 简表」描述 vs Espenak 实现 | 描述不符 |
| **P2** | 10 | spk-loader.js | centerId 死参数 | API 误导 |
| **P2** | 11 | spk-parser.js | jd_*_ms 命名误导；stepDays int32 限整数天 | 可维护性 |
| **P2** | 12 | spk-parser.js | _loadSPK/_getStateSPK 空实现伪兼容 | 误导 |
| **P2** | 13 | spk-parser.js | splineEval 未利用帧间单调性 | 可选优化 |
| **P2** | 14 | kernels/ | de440s.bsp(32MB)+de440s_data.bin(31MB) 原始文件随包部署 | 体积浪费 |

---

## 五、修复优先级建议

1. **立即**：统一 index.html 与 sw.js 的 spk 版本号为 v67（P0）。
2. **本次合入前**：重写 spk-loader.getState 为「直接用 399/301/3 差分」（P1-2），并让 threeBodyStateKm 在 SPK 返回 null 时继续降级（P1-4）。
3. **合入前或紧随**：修复 updateSystem 月球覆盖问题（P1-3）——若确认只提升地球/EMB 精度，则把目标描述改为「提升 EMB/地球渲染精度」；若要月球也走 SPK，需移除 SATELLITES 循环对 Moon 的 Meeus 覆盖。
4. **后续**：`_loadBuffer` 改为按 `_parser._format==='compact'` 判定可用性（P1-5）；明确日月食引擎是否接 SPK（P1-6）；月球/地球改差分存储（P1-7，需改生成脚本）。
5. **低优先级**：清理 P2 的注释/命名/空实现/体积问题。
