# OpenCode 后续任务交接

更新时间：2026-08-26

本文档用于把当前项目状态和后续任务交给 OpenCode。请先阅读本文件，再阅读 `analysis-records/` 中的历史记录。

## 1. 项目目标

这是一个纯前端、离线可运行的实时太阳系可视化项目。当前阶段重点是先把太阳、地球、月球的坐标、时间尺度和显示关系做正确，再逐步恢复和提高其他天体功能的精度。

## 2. 已完成

- 主页面支持 UTC/CST 民用时间输入。
- 时间链路统一为：

  ```text
  民用时间 -> UTC JD -> NASA/Espenak ΔT -> TT JD -> 轨道计算
  ```

- 支持天文年输入和历史历法：`0000` 表示 1 BC，`-0199` 表示公元前 200 年。
- 支持日心/地心参考系。
- 地心模式使用逐时刻重算的相对视轨，不是简单平移日心椭圆。
- 首屏默认聚焦地球，太阳、地球、月球同时进入视野。
- 首屏默认隐藏小行星带、柯伊伯带、其他卫星、星座连线和全景雷达，用户仍可手动开启。
- `window.__ephemeris` 已暴露只读验证接口：
  - `civilToJd`
  - `jdToCivil`
  - `deltaTSecondsForYear`
  - `deltaTSecondsForJd`
  - `utcJdToTtJd`
  - `ttJdToUtcJd`
  - `currentUtcJd`
  - `currentTtJd`
  - `parseDateToTtJd`
  - `positionKm`
  - `moonGeocentricKm`
  - `threeBodyStateKm`
  - `threeBodyResidualKm`
- 三体接口的代数不变量已验证：
  - `Earth + μ * MoonGeo = EMB`
  - `Moon - Earth = MoonGeo`

## 3. 当前实现和数据依据

### 太阳

- 日心坐标模式中太阳定义为 `[0, 0, 0]`。
- 这表示坐标原点，不是太阳相对太阳系质心的精密运动。

### 地球

- 运行时使用 `solar_system_data.js` 中的 JPL SSD《Approximate Positions of the Planets》Table 1 近似根数。
- 地球根数的来源对象是地月质心（EM Bary）。
- 程序通过月球质量比进行地心修正：

  ```text
  Earth = EMB - 0.012150668 * MoonGeo
  ```

- 轨道计算是开普勒两体模型，不是 DE440/DE441 数值积分。

### 月球

- 使用 Jean Meeus《Astronomical Algorithms》第 47 章月球 60+60 项近似历表。
- 包含主项、附加项、离心率因子和岁差转换到 J2000 黄道坐标系。
- `MoonGeo` 是地心月球矢量，`Moon` 是月球日心坐标。

### 时间

- 内部位置函数要求输入 `jdTt`，即 TT 儒略日。
- 不要把 UTC JD 直接传给 `threeBodyStateKm()` 或 `positionKm()`。
- 主页面进入 `sky.html` 时应传回 UTC JD，因为 `sky.js` 自己处理 UT/TT。

## 4. 已知精度结果

已有 HORIZONS/DE441 对照记录见：

- `analysis-records/analysis-20260821-timescale-validation.md`
- `analysis-records/analysis-20260821-core-three-body.md`
- `analysis-records/analysis-20260826-current-three-body.md`

代表性结果：

| 历元 | 地球日心位置误差 | 月地矢量误差 |
| --- | ---: | ---: |
| J2000 | 约 2,006 km | 约 5 km |
| 2024-04-08 日食 | 约 5,639 km | 约 6 km |
| 公元前 200 年 | 约 42,105 km | 约 92.5 km |

2026-08-26 当前模型输出：

- `JD(UTC) = 2461278.500000000`
- `JD(TT) = 2461278.500873377`
- `ΔT ≈ 75.46 s`
- 地日距离约 `151,195,478 km`
- 月地距离约 `398,008.5 km`

这些结果适合可视化和小时级演示，不适合导航、测量或精密天文计算。

## 5. 当前要做的事情

### 5.1 先做回归基线

1. 确认工作区已有用户改动，不要覆盖或回滚无关修改。
2. 执行：

   ```bash
   node --check app.js
   node --check sky.js
   node --check sw.js
   git diff --check
   ```

3. 启动临时 HTTP 服务验证页面：

   ```bash
   python3 -m http.server 4185
   ```

4. 使用无旧 Service Worker 缓存的新端口打开 `index.html`。
5. 在浏览器控制台检查：

   ```js
   const e = window.__ephemeris;
   e.threeBodyResidualKm(2451545.0);
   e.threeBodyStateKm(2451545.0);
   ```

6. 确认页面无新增控制台错误，首屏活动对象为 `Earth`，且太阳/地球/月球可见。

### 5.2 检查时间尺度和参考系

- 验证 `2024-04-08 20:00 UTC`、`2024-04-09 04:00 CST` 是否得到相同 TT 历元。
- 验证 `2000-01-01 12:00 UTC` 的 TT JD 约为 `2451545.00073928`。
- 验证地心模式轨道线是逐点重算的相对轨迹。
- 验证 `sky.html` 接收的是 UTC JD，不是 TT JD。
- 检查关闭星历面板时不会覆盖日期控件最后一次输入。

### 5.3 重新确认当前日期精度

- 如果网络可用，用 JPL HORIZONS 对 2026-08-26 或当天日期做一次相同参数对照：
  - 目标地球 `399`，中心 `@sun`
  - 目标月球 `301`，中心 `@399`
  - `VECTORS`
  - `REF_PLANE=ECLIPTIC`
  - `REF_SYSTEM=J2000`
  - `VEC_CORR=NONE`
  - 单位 km
- 只在成功解析返回数据后写入误差，不要根据失败请求猜测误差。
- 将结果追加到新的 `analysis-records/analysis-YYYYMMDD-*.md`。

## 6. 准备做的事情（按优先级）

### P0：保持三体结果可复现

- 增加一个不依赖手工浏览器操作的回归脚本或测试入口，覆盖：
  - UTC/CST → TT
  - J2000
  - 2024 日食
  - 当前日期
  - 三体代数残差
- 测试输出必须区分：
  - 数值闭合误差
  - 相对 DE441 的物理误差

### P1：统一跨页面时间模块

- 抽取公共时间函数，避免 `index.html`、`sky.html`、`moon.html`、发射场和历史剧场各自实现不同的时间路径。
- 明确每个页面的时间合同：
  - 主太阳系页面：内部 TT
  - 地面观星页面：输入/显示 UT，内部按自身规则转 TT
  - 月面/发射场页面：明确使用 UTC、UT 或 TT，并在代码注释中写清楚
- 给每个跨页面跳转加一条时间转换回归。

### P1：提高太阳/地球/月球精度的方案评估

比较以下方案，不要直接重写现有模型：

1. 继续使用当前近似模型，明确标注误差和适用范围。
2. 接入可离线缓存的 DE440/DE441 或 NAIF SPICE 数据。
3. 仅对太阳、地球、月球接入更高精度数据，其他天体继续使用近似根数。

评估时必须明确：文件体积、许可证、离线加载方式、TDB/TT 处理、参考系、中心天体、几何/视位置设置、深时覆盖范围和性能。

### P2：恢复其他天体显示

- 每恢复一类就增加独立回归，不要一次性打开所有效果。
- 顺序建议：
  1. 主要行星
  2. 主要卫星
  3. 彗星
  4. 航天器
  5. 小行星带和柯伊伯带
  6. 深空环境和星座效果
- 默认显示策略只影响渲染，不要删除或破坏已有轨道数据。

### P2：修正文案和来源声明

- 所有“真实”“实测”“精确”等词必须对应实际数据源和误差等级。
- HORIZONS/DE441 是独立验证或数据参考时，要明确写出，不要暗示页面实时联网读取。
- 近似模型、历史 `ΔT`、深时外推和主要卫星简化轨道都要保留边界说明。

## 7. 验收标准

- `node --check app.js sky.js sw.js` 全部通过。
- `git diff --check` 通过。
- `package-source.sh` 能生成可运行 ZIP，解压后根目录存在 `index.html`。
- 新端口打开页面时不命中旧 Service Worker 缓存。
- 页面无新增控制台错误。
- 首屏默认聚焦地球，太阳、地球、月球可见。
- `threeBodyResidualKm()` 在 J2000、2024、当前日期均保持机器精度量级。
- 日期输入和 UTC/CST/TT 合同不回归。
- 任何精度结论都必须附带参考系、中心天体、时间尺度、单位和误差来源。
- 不得把当前实现称为 DE440/DE441 精密星历。

## 8. 常用命令

```bash
# 语法和空白检查
node --check app.js
node --check sky.js
node --check sw.js
git diff --check

# 本地运行
python3 -m http.server 4185

# 打包
sh package-source.sh /tmp/realtime-solar-system-check

# 查看状态
git status --short
git diff --stat
```

## 9. 重要文件

- `app.js`：主页面渲染、轨道和时间逻辑。
- `solar_system_data.js`：行星近似根数和来源元数据。
- `sky.js`：地面观星页面。
- `index.html`：主页面 UI 和脚本版本参数。
- `sw.js`：Service Worker 和缓存版本。
- `analysis-records/`：逐轮分析、验证和限制记录。
- `README.md` / `README.en.md`：用户文档和来源声明。

## 10. 当前限制

- 当前模型不是 DE440/DE441 精密星历。
- 太阳在日心模式中固定为原点。
- 行星是 JPL SSD 近似根数加开普勒两体模型。
- 月球是 Meeus 近似历表，现代日期误差为公里量级，不是测量真值。
- 古代日期的 `ΔT` 是历史估计，不能视为观测值。
- 主要卫星（除月球）仍为简化椭圆轨道。
- HORIZONS 当前日期对照可能受网络连接限制；网络失败时必须记录“未完成对照”，不能补写估计数字。
