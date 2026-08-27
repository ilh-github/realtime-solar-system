# DE441 升级交接文档（±5000 年真实星历）

更新时间：2026-08-27

本文档是「太阳系可视化项目」从 DE440（±150 年）升级到 DE441（±5000 年）的完整执行规格，交给 OpenCode 按步骤实施。请先阅读本文件，再动手。

---

## 1. 背景与目标

- 项目是纯前端离线太阳系可视化，天体位置用 JPL 星历（SPK）计算。
- 当前实现：`kernels/de440s_compact.bin`，覆盖 **1850–2150（±150 年）**，月球/地球 1 天步长、行星 7 天步长，体积 4.5 MB。
- **新需求**：公元上下 5000 年（**-5000 到 +5000，天文纪年**）都要真实星历结果，不得用近似模型外推。

**硬约束（已核实，官方论文）**：

| 星历 | 覆盖范围 | 能否满足 ±5000 年 |
|------|---------|------------------|
| DE440 | 1550 – 2650 | 否 |
| DE441 | -13200 – +17191 | 是（唯一选择） |

所以必须切换到 **DE441**。

---

## 2. 已完成的准备工作（无需重做）

1. **数据源确认**：`de441.bsp` 完整版 3.08 GB（3,307,878,400 字节），下载地址（支持断点续传 `Accept-Ranges: bytes`）：
   ```
   https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de441.bsp
   ```
   备选（NAIF 分块，各 1.54 GB）：
   ```
   https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de441_part-1.bsp
   https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de441_part-2.bsp
   ```

2. **下载已启动**（后台，截至写本文档时约 1.6/3.08 GB）。续传/校验命令：
   ```bash
   curl -L -C - --retry 3 -o kernels/de441.bsp \
     "https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de441.bsp"
   ls -la kernels/de441.bsp   # 应等于 3307878400 字节
   ```

3. **解析环境已装好**：venv 位于
   ```
   /Users/timbl/.workbuddy/binaries/python/envs/default/bin/python
   ```
   已装 `jplephem 2.24` + `numpy 2.5.2`。

4. **jplephem API 已确认**：
   - `SPK.open(path)` 打开内核；`kernel.segments` 列出所有 segment。
   - segment 属性：`.center` `.target` `.start_jd` `.end_jd`。
   - `seg.compute(jd)` 返回 `[x,y,z]` km（相对 center）；`compute_and_differentiate` 返回速度（单位 km/day）。
   - **超范围 compute 抛 `OutOfRangeError`**，必须先判断 `start_jd <= jd <= end_jd`。
   - de441.bsp 每个天体有 **2 个 segment**（约 1950 年分界）：`-3100015.5..2440432.5` 和 `2440432.5..8000016.5`。提取时需遍历找「覆盖该 jd」的 segment。

5. **生成脚本框架**：`generate_de441_compact.py` 已有一版（含 find_segment / ssb_position / 格式读写），但 `build_segments` 需要按本文档第 4、5 节的 per-body 步长表重写。

---

## 3. 坐标约定（与现有实现保持一致）

- 所有存储位置是 **SSB（太阳系质心）绝对坐标**，ICRF 赤道系，单位 km。
- 目标天体 12 个，NAIF ID：

| NAIF | 天体 | SSB 绝对坐标计算方式 |
|------|------|---------------------|
| 10 | 太阳 | `kernel[0,10].compute(jd)` |
| 1–2, 4–9 | 水星~海王星、冥王星 | `kernel[0,naif].compute(jd)` |
| 3 | EMB（地月质心） | `kernel[0,3].compute(jd)` |
| 301 | 月球 | `kernel[0,3] + kernel[3,301]` |
| 399 | 地球 | `kernel[0,3] + kernel[3,399]` |

- 存储 float32。**注意**：绝对坐标 float32 量化误差对月球约 16 km，可接受（与现有实现同量级），本次不引入差分存储。
- **不存储速度**（速度由前端三次样条对位置求导得到，与现有实现一致）。

---

## 4. 分级步长（核心设计，已实测验证）

三次样条插值误差与步长强相关，且**因天体周期而异**（实测 ±150 年范围随机采样最大误差，单位 km）：

| 天体 | 1 天 | 2 天 | 4 天 | 7 天 | 15 天 | 30 天 |
|------|------|------|------|------|-------|-------|
| 月球 | 4.8 | 89 | 2032 | 25381 | 516043 | 780500 |
| 地球 | 0.1 | 1.4 | 30.6 | 391 | 7321 | 36148 |
| 水星 | 17.7 | 289 | 4971 | 71326 | 2140099 | 18528574 |
| 火星 | 0.0 | 0.1 | 2.1 | 18.7 | 406 | 7074 |
| 木星 | 0.0 | 0.0 | 0.0 | 0.0 | 0.6 | 10.4 |
| 海王星 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

结论：**步长必须按天体定制**。设计为两档：近期（|Δt| ≤ 150 年）精、远期（150 年 < |Δt| ≤ 5000 年）粗。

**最终步长表（per-body，单位：天）**：

| NAIF | 天体 | 近期步长 | 远期步长 | 远期插值误差(约) |
|------|------|---------|---------|-----------------|
| 301 | 月球 | 1 | 4 | ~2000 km |
| 399 | 地球 | 1 | 7 | ~390 km |
| 1 | 水星 | 2 | 4 | ~5000 km |
| 2 | 金星 | 7 | 15 | ~500 km |
| 3 | EMB | 7 | 15 | ~400 km |
| 4 | 火星 | 7 | 15 | ~400 km |
| 5 | 木星 | 7 | 30 | ~10 km |
| 6 | 土星 | 7 | 30 | ~10 km |
| 7 | 天王星 | 7 | 30 | ~1 km |
| 8 | 海王星 | 7 | 30 | ~0 km |
| 9 | 冥王星 | 7 | 30 | ~1 km |
| 10 | 太阳 | 7 | 30 | 小 |

体积预估：约 **50 MB**（月球/地球/水星是主要大头）。

---

## 5. 紧凑格式 v2（多 segment）

Header（28 字节）：

| 偏移 | 类型 | 字段 | 说明 |
|------|------|------|------|
| 0 | u32 | magic | `0x44453434`（保持，与 v1 相同） |
| 4 | u32 | n_bodies | 12 |
| 8 | u32 | pad | 0 |
| 12 | i64 | jd_start_ms | 全局起始 JD×1000 |
| 20 | i64 | jd_end_ms | 全局结束 JD×1000 |

每个 body（按 BODIES 顺序）：

| 类型 | 字段 |
|------|------|
| i32 | naif_id |
| i32 | n_segments（通常 2：近期段 + 远期段） |
| × n_segments： | |
| i32 | n_epochs |
| i32 | step_days（整数天） |
| i64 | seg_start_ms（该段起始 JD×1000） |
| f32[n_epochs×3] | xyz 交错（x0,y0,z0,x1,y1,z1,…） |

分段方式：每个天体的近期段覆盖 `[J2000-150y, J2000+150y]`，远期段覆盖 `[J2000-5000y, J2000-150y]` 与 `[J2000+150y, J2000+5000y]`。为简单与样条连续，建议把每个天体拆成 **5 段**（时间正序连续、无重叠）：

```
[-5000y .. -150y] 远期步长
[-150y  .. 0    ] 近期步长
[0      .. +150y] 近期步长
[+150y  .. +5000y] 远期步长
```

（0 边界拆成两段只是实现便利，步长相同，不影响结果。）采样点用 `np.arange(ceil(start/step)*step, end + step/2, step)` 生成，保证覆盖段端点。

---

## 6. 任务清单（按顺序执行）

### 任务 A：确认下载完成
```bash
ls -la kernels/de441.bsp   # 3307878400 字节
```

### 任务 B：修正生成脚本
编辑 `generate_de441_compact.py`：
1. 用第 5 节的 per-body 步长表替换现有 `STEP_TABLE` + `BODIES`。
2. `build_segments` 改为「按第 5 节的 5 段拆分」生成 `[(seg_start_jd, step_days, jd_list), ...]`。
3. `ssb_position` 保留现有实现（`find_segment` 遍历 + EMB 合成）。
4. 运行：`python generate_de441_compact.py kernels/de441.bsp kernels/de441_compact.bin 5000`
   预期输出约 50 MB。

### 任务 C：扩展 spk-parser.js 支持 v2 多 segment
当前 `parseCompactFormat` 假设每体单一 `step_days`。改为：
- 读 body 头 `naif_id + n_segments`；逐段读 `n_epochs + step_days + seg_start_ms + f32 data`。
- 每段构建独立的三次样条（`jds = seg_start + e*step_days`）。
- `_getBodyState` 查询时：先定位「覆盖目标 jd 的段」（`jd >= seg_start && jd <= seg_end`），再用该段样条求值；无覆盖段返回 null。
- 保留 `_loadSPK`/`_getStateSPK` 为空实现（Type 2 已废弃）。
- 保持 `getState(targetId, centerId, jdTt)` 对外签名不变（返回 SSB ICRF 状态，速度 `/=86400`）。

### 任务 D：切换默认内核路径
- `spk-loader.js`：`tryLoadFromPath` 默认路径改为 `./kernels/de441_compact.bin`。
- `sw.js`：`PRECACHE` 中 `./kernels/de440s_compact.bin` → `./kernels/de441_compact.bin`，`VER` 升到 `v68`。
- `index.html`：`spk-parser.js` / `spk-coord.js` / `spk-loader.js` 版本号 `?v=67` → `?v=68`。

### 任务 E：验证（见第 7 节）

---

## 7. 验证标准

1. **语法**：`node --check` 对 `spk-parser.js spk-coord.js spk-loader.js app.js sw.js` 全过。
2. **端到端**（node 模拟 window 加载三模块，用 `loadFromFile(mockFile)` 传 ArrayBuffer）：
   - 正常加载 → `isAvailable()===true`。
   - `getState(2451545.0)`：月地距离 ≈ **402448 km**，`|earth-emb|` ≈ **4890 km**，moonGeo 语义偏差 = 0。
   - 超范围 `getState(2900000.0)`（+1000 年）与 `getState(-105205.0)`（-5000 年）→ **非 null**（这是新能力）。
   - 损坏 buffer（magic 不匹配）→ `isAvailable()===false`。
3. **交叉验证（HORIZONS DE441 权威对照）**，历元 TT JD `2461278.500873377`：
   - 地球日心黄道位置对比 DE441 `[134021953.025, -69976595.382, 3573.101]`，误差应 **< 5 km**。
   - 月地矢量对比 `[240755.576, -316628.740, -13883.157]`，误差应 **< 5 km**。
   - （旧 DE440 实现同历元误差 1.13/1.94 km，DE441 数据应同量级。）
4. **近期精度不回退**：J2000 附近月地距离、地球位置与现有 de440s_compact.bin 结果一致（差异 < 5 km）。

---

## 8. 注意事项

- de441.bsp 每个天体 2 段（1950 分界），`find_segment` 必须遍历 `kernel.segments` 找覆盖 jd 的段，不要用 `kernel[0,naif]`（可能只返回第一段）。
- jplephem `compute` 超范围抛异常，先判断 `start_jd/end_jd`。
- float32 绝对坐标量化误差月球约 16 km，可接受；不要引入差分存储（保持与现有 parser 兼容）。
- 只存位置、不存速度；速度由前端样条求导 `/=86400` 得到（现有逻辑）。
- 生成后 `kernels/de441.bsp`（3.08 GB）是中间产物，**不提交**；`.gitignore` 需排除 `kernels/de441.bsp` 与 `kernels/de440s.bsp`、`kernels/de440s_data.bin`，只保留 `kernels/de441_compact.bin`。
- 现有 `test-spk.js` 已失效（测 de440s.bsp 的 Type 2 路径），建议删除或改为测 `de441_compact.bin`。

---

## 9. 参考

- 误差实测与旧版审查：`analysis-records/analysis-20260827-spk-de440-review.md`、`analysis-20260827-spk-de440-fix-review.md`。
- HORIZONS DE441 对照数据：`analysis-records/analysis-20260826-regression-and-horizons.md`。
- 现有 v1 格式实现：`spk-parser.js` 的 `parseCompactFormat`。
