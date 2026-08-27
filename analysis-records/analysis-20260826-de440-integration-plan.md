# 2026-08-26 · 高精度星历接入计划（DE440s.bsp）

## 目标

接入 JPL DE440s.bsp（31 MB，1849–2150），将日/地/月位置误差从数千公里降到 <1 km，同时保持现有近似模型作为降级路径。

## 架构现状

- 纯前端项目，无 npm，所有 JS 通过 `<script>` 标签加载
- 当前坐标系：**日心原点 + J2000 黄道系**
- `updateSystem()` 渲染主循环直接调用 `heliocentricKm()` + `moonGeoKm()` 计算所有天体位置
- `threeBodyStateKm()` 是只读快照函数，供外部验证
- Earth 轨道根数实际对应 **EM Bary（地月质心）**，需减去月球偏移得到真实地心

## 新增文件（3个）

| 文件 | 职责 | 预估行数 |
| --- | --- | ---: |
| `spk-parser.js` | DAF/SPK Type 2 二进制解析器（Chebyshev 插值） | ~400 |
| `spk-coord.js` | ICRF→J2000 黄道旋转 + SSB→日心转换 | ~80 |
| `spk-loader.js` | 内核检测/加载/查询封装，暴露 `window.SPK` | ~150 |

## 修改文件（3个）

| 文件 | 改动 |
| --- | --- |
| `index.html` | 加载新模块（spk-parser → spk-coord → spk-loader） |
| `sw.js` | 预缓存新模块 + VER v66 |
| `app.js` | `threeBodyStateKm` + `updateSystem` 加 SPK 优先路径 |

## 实现步骤

### Step 1: SPK 解析器 (`spk-parser.js`)

实现 DAF（Data Annotation Facility）文件格式的读取：
- 文件记录解析（8字节双精度数组，ND/NA/LOCIFR）
- 目录记录读取（段起止时间、目标/中心天体 ID）
- 按目标 ID + TT JD 定位段（二分查找）
- Type 2 Chebyshev 多项式求值（13 阶，3 分量 x/y/z）

核心 API：
```javascript
window.SPK = {
  parse(arrayBuffer) → void,
  getState(targetId, centerId, jdTt) → [x,y,z,vx,vy,vz] | null,
  getPosition(targetId, centerId, jdTt) → [x,y,z] | null,
  getSegments() → [{target, center, start, end, type}],
  isLoaded() → boolean
};
```

NAIF ID 映射（de440s.bsp 包含）：
| NAIF ID | 天体 |
| --- | --- |
| 10 | 太阳 |
| 199 | 水星 |
| 299 | 金星 |
| 399 | 地球（EM Bary） |
| 499 | 火星 |
| 599 | 木星 |
| 699 | 土星 |
| 799 | 天王星 |
| 899 | 海王星 |
| 301 | 月球 |

### Step 2: 坐标变换 (`spk-coord.js`)

SPK 输出：ICRF 赤道系 + SSB 原点
项目需要：J2000 黄道系 + 日心原点

变换：
1. ICRF→J2000 黄道：绕 X 轴旋转 ε_A = 23°26'21.448"（黄赤交角）
2. SSB→日心：减去太阳（NAIF 10）的 SSB 位置

```javascript
window.SPK_COORD = {
  icrfToEcliptic([x,y,z]) → [x',y',z'],
  ssbToHeliocentric(ssbPos, sunSsbPos) → [x,y,z],
};
```

### Step 3: 加载器与集成 (`spk-loader.js`)

```javascript
window.SPK_LOADER = {
  async tryLoadFromPath(path) → boolean,
  async loadFromFile(file) → boolean,
  isAvailable() → boolean,
  getState(jdTt) → {jdTt, sun, emb, earth, moon, moonGeo} | null,
};
```

getState 返回格式与 `threeBodyStateKm` 完全一致，确保兼容。

### Step 4: 集成到 `app.js`

改动点 1: `threeBodyStateKm`（~7438行）
```javascript
function threeBodyStateKm(jdTt) {
  if (!Number.isFinite(jdTt)) return null;
  // SPK 优先路径
  if (window.SPK_LOADER && window.SPK_LOADER.isAvailable()) {
    return window.SPK_LOADER.getState(jdTt);
  }
  // 现有近似模型（降级）
  const sun = [0, 0, 0];
  const emb = heliocentricKm(bodyByName.Earth.orbit_j2000, jdTt, [0, 0, 0]);
  // ... 现有逻辑不变
}
```

改动点 2: `updateSystem`（~2511行）
```javascript
// 在现有地月质心修正后追加：
if (window.SPK_LOADER && window.SPK_LOADER.isAvailable()) {
  const spkState = window.SPK_LOADER.getState(jd);
  if (spkState) {
    worldKm.Earth = spkState.earth;
    worldKm.Moon = spkState.moon;
    // 更新质心偏移
    baryOff.Earth = [...spkState.earthOffset];
  }
}
```

### Step 5: 内核检测与用户交互

- **自动检测**：页面加载时 `fetch('./kernels/de440s.bsp', {method:'HEAD'})` 检测文件是否存在
- **文件选择器**：UI 中添加"加载高精度内核"按钮
- **状态指示**：加载成功后状态栏显示 "DE440 模式" 标识

### Step 6: 回归验证

| 锚点 | 验证方法 |
| --- | --- |
| J2000 | SPK 地球位置 vs HORIZONS（误差 <1 km） |
| 2024 日食 | 月地距离 ≈ 360,000 km |
| 当前时刻 | 与现有模型差 <1000 km（地球）、<10 km（月球） |
| 深时回退 | 1849 年前自动切换回近似模型 |

## 体积与性能

| 项 | 影响 |
| --- | --- |
| 新增 JS 代码 | ~630 行，压缩后约 15-20 KB |
| de440s.bsp | 31 MB（用户自备，不打包） |
| 首次加载 | 内核解析约 100-200 ms（一次性） |
| 每帧查询 | O(1) Chebyshev 求值，<0.01 ms |
| 内存 | ~35 MB（内核 + 解析结果缓存） |

## 关键风险

1. SPK Type 2 解析器正确性：需与 NAIF 参考实现交叉验证
2. ICRF→黄道旋转：旋转角 ε_A 精度选择（影响约 0.01″）
3. SSB→日心转换：需同时查询太阳位置（NAIF ID=10, center=SSB）
4. 深时边界：1849 年前自动回退近似模型，需平滑切换无跳变

## 内核获取

从 NAIF 官方下载：https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp
放到项目 `./kernels/de440s.bsp` 路径即可。
