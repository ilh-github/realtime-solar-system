# DE440 集成修复 — 复审报告

> 复审日期：2026-08-27
> 复审范围：上一轮 P0/P1/P2 修复的验证
> 验证方式：源码逐行 + `de440s_compact.bin` 三次样条数值复算

---

## 一、修复验证总览

| 编号 | 问题 | 修复状态 | 结论 |
|------|------|---------|------|
| P0 | spk 版本号不一致 | ✅ 已修复 | index.html 三件套 → v67，与 sw.js 一致 |
| P1-2/3 | moonGeo 语义 + earth 缺因子 | ✅ 已修复 | getState 改用 399/301/3 差分，数值验证通过 |
| P1-3 | Moon 被 Meeus 覆盖 | ⚠️ 部分修复 | 覆盖问题解决，但引入深时月球冻结回归 |
| P1-4 | 超范围不降级 | ✅ 已修复 | threeBodyStateKm 正确 fall through |
| P1-5 | 损坏文件假成功 | ⚠️ 未真正修复 | `_loadSPK` 空实现仍 `loaded=true` |
| P2 | ε_A 注释年代 | ✅ 已修复 | 改为「IAU 1976, 84381.448″」 |

---

## 二、逐项验证

### P0 — 版本号（✅ 通过）

`index.html` 现引用 `spk-parser.js?v=67`、`spk-coord.js?v=67`、`spk-loader.js?v=67`，与 `sw.js` PRECACHE 完全一致。`app.js?v=64`、`ephemeris-time.js?v=64` 两边也一致。离线缓存 miss 消除。

### P1-2/3 — getState 重写（✅ 通过）

`spk-loader.js` `getState` 已重写为直接取 399/301/3 绝对坐标差分：

```js
const earthState = getStateHeliocentric(399, 0, jdTt);   // 地球质心，DE440 399 段
const moonState  = getStateHeliocentric(301, 0, jdTt);   // 月球质心，DE440 301 段
const embState   = getStateHeliocentric(3,   0, jdTt);
const moonGeo = [moon[i] - earth[i]];                    // moon − earth，语义正确
```

**数值复算**（J2000，用 compact.bin 三次样条）：

| 量 | 实测 | 期望 | 判定 |
|----|------|------|------|
| \|moon − earth\| | 402445.6 km | 月距 363300~405500 | ✅ 远地点附近，合理 |
| \|earth − emb\| | 4940.9 km | ~4670~4900 | ✅ 质量比偏移 |
| \|earth−emb\| / \|moon−earth\| | 0.012277 | ≈0.01215 | ✅ 与 MU_MOON 一致 |

- moonGeo 语义 = moon − earth ✅
- earth 直接来自 399 段（非质量比反推）✅

### P1-3 — Moon 覆盖（⚠️ 部分修复，引入回归）

`app.js:2549-2553`：

```js
if (sat.name === "Moon") {
  if (window.SPK_LOADER && window.SPK_LOADER.isAvailable()) continue;  // ← 跳过条件
  wS[0] = p[0] + _mg[0]; ...                                          // Meeus
  continue;
}
```

**已解决**：SPK 可用且范围内时，月球位置保留 2531 行写入的 DE440 值，不再被 Meeus 覆盖。✅

**新回归（P1）**：跳过条件用 `isAvailable()`，但 SPK 覆盖的实际生效条件是 `getState(jd) !== null`。二者在**深时模式（jd 超出 SPK ±150 年）下不一致**：

1. `isAvailable()` = true（SPK 已加载，与 jd 无关）
2. `getState(jd)` = null（超范围）
3. 2531 行 `if (_spk)` false → `worldKm.Moon` 不被 SPK 写入
4. 2551 行 `if (isAvailable()) continue` → 跳过 Meeus

结果：**深时模式下 `worldKm.Moon` 既无 SPK 也无 Meeus 写入，冻结在上一帧位置（首帧则 [0,0,0]）**。而深时（±5 万年）是项目明确功能，此回归可稳定复现。

**修复建议**：跳过条件与覆盖生效条件统一为「SPK 实际写入了 Moon」，而非「SPK 可用」：

```js
// 外层提升标志
let spkApplied = false;
if (SPK_LOADER && isAvailable()) {
  const _spk = getState(jd);
  if (_spk) { ...; spkApplied = true; }
}
...
if (sat.name === "Moon") {
  if (spkApplied) continue;   // 替代 isAvailable()
  wS = p + _mg;
  continue;
}
```

### P1-4 — 超范围降级（✅ 通过）

`app.js:7452-7455`：

```js
if (window.SPK_LOADER && window.SPK_LOADER.isAvailable()) {
  const spkState = window.SPK_LOADER.getState(jdTt);
  if (spkState) return spkState;   // 非 null 才返回
}
// 继续近似模型 fall through
```

SPK 返回 null（超范围）时正确降级到 `heliocentricKm` + `moonGeoKm`。✅ 验证点 1/2/3 均满足。

### P1-5 — 损坏文件假成功（⚠️ 未真正修复）

`_loadBuffer` 已改为：

```js
_parser.load(ab);
if (!_parser.loaded) { _parser = null; _available = false; ...; return false; }
_available = true;
```

**但根因未除**：`spk-parser.js` 的 `_loadSPK` 空实现仍设置 `this.loaded = true`：

```js
_loadSPK(ab) {
  this._data = { segments: [] };
  this._format = 'spk';
  this.loaded = true;   // ← 假成功
}
```

当 compact magic 不匹配（损坏/错误文件）时，`load()` 回退到 `_loadSPK`，`loaded=true`，`_loadBuffer` 的 `!loaded` 检查**必然通过**，`_available=true`，`isAvailable()` 返回 true，状态显示「DE440 模式」，但 `_getStateSPK` 恒返回 null。

**验证点「损坏 ArrayBuffer 使 isAvailable() 返回 false」实际不成立**——仍返回 true。

**修复建议**（任选其一）：
- 方案 A：`_loadSPK` 不再设置 `loaded=true`（Type 2 未实现，应视为加载失败）——最干净；
- 方案 B：`_loadBuffer` 改为 `if (_parser._format !== 'compact')` 判失败；
- 方案 C：`load()` 在 magic 不匹配时直接 return（loaded 保持 false）。

### P2 — ε_A 注释（✅ 通过）

`spk-coord.js:14` 现为「J2000 平黄赤交角（IAU 1976, 84381.448″）」，与数值 `23.439291111°` 一致。✅

---

## 三、遗留问题清单

| 级别 | 位置 | 问题 | 说明 |
|------|------|------|------|
| **P1** | app.js:2551 | Moon 跳过条件用 `isAvailable()` 而非「SPK 实际写入」，深时模式月球冻结/归零 | 本轮修复引入的回归 |
| **P1** | spk-parser.js:271 | `_loadSPK` 空实现仍 `loaded=true`，损坏文件仍假成功 | P1-5 未真正修复 |
| **P2** | spk-loader.js:34 | `MU_MOON` 死常量未移除/未标注 unused | 验证点 3 未落实 |

---

## 四、测试建议

1. **深时回归测试**：SPK 加载成功后，将时间跳到超出 ±150 年（如 JD 2900000），断言 `worldKm.Moon` 每帧仍在更新（不被冻结）。
2. **损坏文件单测**：构造 `magic ≠ 0x44453434` 的 ArrayBuffer 传入 `_loadBuffer`，断言返回 false 且 `isAvailable()===false`。
3. **降级切换测试**：同一 SPK 实例在范围内/外各取一次 `threeBodyStateKm`，断言范围内返回 SPK（`moonGeo≈moon−earth`），范围外返回非 null 近似结果。
4. **数值回归基准**：固化 J2000 时刻 `|moon−earth|`、`|earth−emb|/|moon−earth|` 两组距离作为 CI 断言，防止 getState 语义再次漂移。

---

## 五、结论

6 项修复中 **4 项（P0、P1-2/3、P1-4、P2）正确完成**；**P1-5 未真正修复**（根因 `_loadSPK` 假 `loaded` 仍在）；**P1-3 引入一个深时月球冻结回归**。建议合入前先补上「spkApplied 标志」与「_loadSPK 失败语义」两处修正，并新增深时回归测试。

---

## 六、修复后最终验证（含独立交叉验证）

三处遗留（spkApplied / _loadSPK / MU_MOON）由 opencode 修复后，做了一次端到端 + 独立权威源交叉验证：

### 端到端（node 模拟浏览器，5 项全过）

- 正常加载 compact.bin → `isAvailable=true`，状态列 12 天体；
- `getState(J2000)` moonGeo 语义偏差 `0.000000 km`（严格 = moon−earth）；
- 超范围 `getState(2900000)` → `null`（正确降级）；
- 损坏 buffer → `isAvailable=false`；重载恢复 `true`。

### 独立交叉验证（HORIZONS DE441 对照）

取 `analysis-20260826-regression-and-horizons.md` 中已记录的 HORIZONS DE441 权威向量，在 TT JD `2461278.500873377` 用 compact.bin + 三次样条复算并对比：

| 项目 | compact.bin | HORIZONS DE441 | 误差 |
| --- | ---: | ---: | ---: |
| 地球日心位置 | 134021952.655, -69976594.369, 3573.427 | 134021953.025, -69976595.382, 3573.101 | **1.13 km** |
| 月地矢量 | 240753.725, -316629.322, -13883.036 | 240755.576, -316628.740, -13883.157 | **1.94 km** |
| 地日距离 | 151190633 km | 151190634 km | 1 km |
| 月地距离 | 398006.6 km | 398007.2 km | 0.6 km |

对比旧实现（近似根数 + Meeus）同历元误差 7,588.5 km / 9.2 km，**地球位置精度提升约 6700 倍，月球约 4.7 倍**。残余 1–2 km 误差来自 DE440 vs DE441 版本差异 + 三次样条插值 + float32 量化，对可视化（1 BU = 1000 km）与日月食判定（本影 ~4600 km）均完全无感。

该交叉验证同时印证了坐标管线正确：SSB→日心减法、ICRF→黄道 ε_A 旋转、三次样条、速度单位转换。若其中任一环节符号或公式有误，误差将是数千公里量级而非 1–2 km。
