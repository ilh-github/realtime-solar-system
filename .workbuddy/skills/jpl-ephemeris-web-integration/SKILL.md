---
name: jpl-ephemeris-web-integration
description: 把 JPL DE 星历（SPK/DE440/DE441）提取成紧凑二进制并集成到前端 three.js 可视化的完整工作流。触发场景：需要高精度、长覆盖范围的行星/月球位置（如 ±5000 年真实结果），涉及下载 bsp 内核、jplephem 提取、紧凑格式生成、三次样条插值、HORIZONS 交叉验证。
agent_created: true
---

# JPL 星历集成到前端（DE440/DE441）

把 JPL Development Ephemeris（DE 系列 SPK 内核）提取成紧凑二进制，供前端 three.js 用三次样条插值查询天体位置。本项目的核心产物是 `generate_de441_compact.py` + `spk-parser.js`。

## 1. 星历选择

| 星历 | 覆盖范围 | bsp 大小 |
|------|---------|---------|
| DE440 | 1550–2650 AD | ~114 MB |
| DE441 | -13200 ~ +17191 AD | ~3.1 GB |

需要超过 ±400 年（如「公元前 5000 ~ 公元 5000」）必须用 DE441。DE441 历史精度低于现代（月球核心-地幔无阻尼假设），对可视化够用。

## 2. 下载与提取（Python + jplephem）

```bash
curl -L -C - --retry 3 -o de441.bsp "https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de441.bsp"
```

- `SPK.open(path)`；用 `kernel.segments` 遍历 segment（属性 `.center` / `.target` / `.start_jd` / `.end_jd`）。
- **DE441 每个天体有 2 个 segment（约 1950 年分界）**。必须用 `find_segment`（遍历找覆盖目标 jd 的段）而不是 `kernel[0,naif]`——后者只返回第一段，对 1950 年前的 jd 会抛 `OutOfRangeError`。
- `seg.compute(jd)` 返回 `[x,y,z]` km（相对 center）；超范围抛 `OutOfRangeError`，先判断 `start_jd <= jd <= end_jd`。
- SSB 绝对坐标：行星 = `kernel[0,naif]`；月球(301)/地球(399) = `kernel[0,3] + kernel[3,301/399]`（EMB 合成）。

## 3. 紧凑格式（多 segment）

```
Header(28B): magic=0x44453434, n_bodies(u32), pad(u32), jd_start_ms(i64), jd_end_ms(i64)
每体: naif_id(i32) + n_segments(i32)
  每段: n_epochs(i32) + step_days(i32) + seg_start_ms(i64) + float32[n_epochs*3]  (xyz 交错)
```

- 只存位置不存速度；速度由前端样条对位置求导 `/86400` 得 km/s。
- float32 绝对坐标量化误差对月球约 16 km，可接受（若需更高精度再改差分存储）。

## 4. 三次样条 + 步长设计（两个关键坑）

### 坑 A：natural spline 端点条件在段边界附近严重失真（P0）

natural cubic spline 端点二阶导数强制 =0。**分段切分点若落在常用查询时刻（如 J2000）附近，该点附近的插值误差会飙升到数万 km**（实测 J2000 落在段边界时 EMB y 分量误差 93837 km，去掉该切分后降到 57 km）。

规避：切分点尽量少、避开关键历元；让 J2000 等常用时刻落在段中间。

### 坑 B：步长必须按天体周期定制

先用「插值误差 vs 步长」实测，再定步长。参考实测（±150 年随机采样最大误差，km）：

| 天体 | 1天 | 2天 | 4天 | 7天 | 30天 |
|------|-----|-----|-----|-----|------|
| 月球(27d) | 5 | 89 | 2032 | 25381 | 780500 |
| 水星(88d) | 18 | 289 | 4971 | 71326 | 18528574 |
| 火星 | 0 | 0 | 2 | 19 | 7074 |
| 海王星(165y) | 0 | 0 | 0 | 0 | 0 |

短周期天体（水星、月球）必须细步长；外行星 30 天步长足够。推荐「近期精、远期粗」分级步长。

## 5. 交叉验证（必须做，否则自洽验证会漏掉系统性错误）

- JPL HORIZONS API 查权威值（`REF_PLANE=ECLIPTIC`, `REF_SYSTEM=J2000`, `VEC_CORR=NONE`），同历元对比。
- 达标线：误差 < 5 km。若坐标旋转方向、样条公式、单位转换任一错误，误差会是数千 km 量级而非 <5 km。
- 用 DE440 数据对比 DE441 参考时，残余 1–2 km 来自星历版本差 + 插值 + float32，属正常。

## 参考

完整实测数据与审查过程见本项目 `analysis-records/analysis-20260827-de441-opencode-review.md` 等报告。
