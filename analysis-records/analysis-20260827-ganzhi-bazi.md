# 干支/八字功能 — 选型、实现与踩坑总结

> 日期：2026-08-27
> 结论：采用官方 `lunar-javascript@1.7.7`（6tail，寿星天文历移植），并对其 2 处负年份 bug 做了最小修正。
> 本文目的：沉淀选型决策 + 算法口径 + 全部踩坑，避免以后重踩。

---

## 一、需求

主页面「时间栏」在公历时间下方实时显示**干支四柱（八字）**：年柱、月柱、日柱、时柱（各两字共八字），随拖动时间滑杆/播放/输入时间实时刷新。时间范围 ±5000 年（含公元前，如夏朝 −2070）。

---

## 二、选型决策

### 2.1 候选库全景（JS 生态）

| 库 | star | 公元前 | 八字 | 节气 | 结论 |
|---|---|---|---|---|---|
| **6tail lunar-javascript** | 1.6k | ✅ 修正后到 −5000 | ✅ 四柱 | ✅ | **采用** |
| 6tail tyme4ts | 353 | ❌ 仅公元 1 年+ | ✅ | ✅ | 作者推荐但无公元前 |
| solarlunar (yize) | 800+ | ❌ 仅 1900–2100 | ⚠️ 无时柱 | ✅ | 查表法，范围窄 |
| lunar-calendar | 1.2k | ❌ | ❌ | ⚠️ | 轻量 |
| chinese-lunar-calendar | 400+ | ❌ | ❌ | ❌ | 无节气 |
| @yhjs/lunar + bazi（承明） | 新 | ⚠️ 仅到公元前 720 年 | ✅ 四柱+大运+神煞 | ✅ 高精度 | 最专业但范围不够 |
| lunar-ts | 新 | ❌ 1900–2100 | ❌ | ✅ | 3KB |
| jingque（惊鹊） | 存疑 | ? | ? | ✅ | npm 上 `jingque` 404，查无此包 |
| cnlunar（Python） | 666 | ? | ✅ | ✅ | 非 JS |

### 2.2 关键结论

**卡死选型的不是"谁更权威"，而是"公元前范围"。** 几乎所有库都主动砍掉了公元前：

- tyme4ts → 公元 1 年起（`year<=0` 抛 `illegal solar year`）
- solarlunar / lunar-ts / lunar-calendar → 1900–2100
- @yhjs（承明）→ 只到公元前 720 年

**能满足「±5000 年 + 公元前 + 八字四柱」组合的，只有 6tail lunar-javascript（修正后）一家。**

### 2.3 权威性背景

- 开源圈 **6tail 一家独大**（lunar-javascript 1.6k star 同类 JS 第一，多语言最全）。
- 算法**源头是许剑伟「寿星天文历」(sxwnl)**，6tail 两个系列（lunar/tyme）都致谢它。
- 6tail 作者已放弃 lunar 系列、主推 tyme（原话"lunar 是屎山、tyme 碾压"），但 **tyme 不支持公元前**，故本项目用不了。
- 绝对官方标准是紫金山天文台《中国天文年历》，非 npm 库。

---

## 三、八字算法口径（别搞错）

| 柱 | 分界规则 |
|---|---|
| **年柱** | 以**立春交接时刻**为界（非正月初一）。立春前属上一年干支 |
| **月柱** | 以十二**节**交接时刻为界（立春=寅月/正月，惊蛰=卯…）。月干五虎遁：`((年干+(index<0?1:0))%5+1)*2%10` |
| **日柱** | 流派 2（默认）：`floor(正午JD) - 11`，干=offset%10、支=offset%12。晚子时（23:00–23:59）日柱算**当天** |
| **时柱** | 时辰地支 `floor((hour+1)/2)%12`（23:00 起子时）。时干五鼠遁用**流派 1 日干**（晚子时算明天）：`(dayGanExact%5*2+zhi)%10` |

其他关键约定：

- **节气时刻是北京时间（东八区）**：寿星历 `ONE_THIRD=1/3天=8h` 偏移。八字计算固定 `UTC+8h`。
- **BASE_MONTH_ZHI_INDEX = 2**（寅=正月）。
- 儒略日分界：`y*372 + m*31 + day >= 588829` 起用格里历，否则儒略历（1582-10-15）。
- 公元前（1582 前）按**儒略历**解释日期。

---

## 四、踩坑记录（重点）

### 坑 1 — lunar 库负年份月柱错成"亥月"（已修）

- **现象**：公元前日期月柱几乎一律"亥月"（乙亥/辛亥/己亥…），实测公元前 5000 组约 79% 错误。
- **根因**：`_computeMonth` 用 `toYmdHms()` **字符串比较**节气时刻。负年份 `"-200-06-15" < "-201-12-10"` 因负号导致年份排序反转（'0'<'1'），日期被误判成"上年大雪之前"，index 恒为 −3（亥月）。
- **修复**：改用 `getJulianDay()` **数值比较**（JD 单调、历法无关）。
- **位置**：`lunar.js` 的 `_computeMonth` 两段循环（非 Exact 用 `Math.floor(getJulianDay()+0.5)` 保留"日期级别"，Exact 用完整 `getJulianDay()`）。

### 坑 2 — lunar 库负 JD 日柱 undefined/NaN（已修）

- **现象**：公元前 4713 年之前（JD<0）日柱输出 `undefined`/`NaN`。Java 版直接抛 `ArrayIndexOutOfBoundsException: Index -4`。
- **根因**：`_computeDay` 的 `offset%10/%12` 对负 offset 得负数，`GAN[负数]` 越界。
- **修复**：取正模 `((offset%10)+10)%10`、`((offset%12)+12)%12`。
- **位置**：`lunar.js` 的 `_computeDay`。

### 坑 3 — Java trunc vs JS floor 儒略日差异（易踩）

- **现象**：Java 版与 JS 版在负 JD 范围（公元前 4717 前）儒略日差 1 天，导致日柱/时柱错位。
- **根因**：Java `Solar.getJulianDay` 用 `(int)` 截断（向零），JS 用 `Math.floor`（向下）。对负的 `365.25*(y+4716)` 两者差 1。
- **结论**：**JS floor 版是标准正确的**（JD 连续，公元前 4713-01-01 正午=JD 0）；Java trunc 是 Java 版的 bug（负 JD 不连续）。
- **教训**：手写移植时别复刻 Java 的 trunc，要用 floor。本项目 `ephemeris-time.js` 与 `lunar.js` 都是 floor 版，自洽。

### 坑 4 — tyme4ts 不支持公元前

- **现象**：`SolarTime.fromYmdHms(-200,…)` 抛 `illegal solar year: -200`，只支持 `year>=1`。
- **结论**：tyme 虽是 6tail 作者主推的升级版，但无法满足 ±5000 年需求。

### 坑 5 — 儒略历/格里历日期差异（易误判为 bug）

- **现象**：公元前日期节气"晚"（如 −1500 年芒种是儒略历 6/21，而现代是公历 6/5）。
- **结论**：这是**儒略历（1582 前）的正常历法差异**，非 bug。验证时**别用格里历直觉**（"6 月 15 日=午月"）去判断儒略历日期——儒略历 6/15 可能落在芒种前=巳月，是**正确**的。

### 坑 6 — 节气算法精度边界

- 寿星历节气在 −1000~+3000 年约 ±1 分钟，超出范围精度下降（−1500 年前更明显）。
- 但用户 ±5000 年内，节气"日期晚"主要是儒略历/格里历差异（坑 5），非算法误差。若要更高精度节气，需换 VSOP87/DE441 级算法（如 @yhjs 承明），非本项目当前需求。

---

## 五、当前实现

### 文件

| 文件 | 改动 |
|---|---|
| `lunar.js` | 新增。官方 `lunar-javascript@1.7.7` 复制版，含 2 处负年份修正（见坑 1/2） |
| `index.html` | 引入 `lunar.js?v=1`（挂 `window.Solar/Lunar/EightChar`）；timeBar 加 `#ganzhiText` 显示行；`app.js?v=65` |
| `app.js` | `const LunarSolar = window.Solar \|\| null`；`ganzhiFromJd()` + `updateGanzhiText()`；主循环 HUD 处调用 |
| `sw.js` | VER v69，PRECACHE 加 `lunar.js?v=1`、`app.js?v=65` |

### 集成逻辑（app.js）

```js
// TT 儒略日 -> 北京时间(auto 历法) -> 八字
function ganzhiFromJd(jdTt) {
  if (!LunarSolar) return null;
  const parts = jdToCivil(ttJdToUtcJd(jdTt) + 8 / 24, "auto");   // +8h 北京时间
  const ec = LunarSolar.fromYmdHms(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0)
                       .getLunar().getEightChar();
  return { year: ec.getYear(), month: ec.getMonth(), day: ec.getDay(), time: ec.getTime() };
}
```

注意：`window.Solar` 是**带静态方法的对象**（`typeof === "object"`，非 function），用 `Solar.fromYmdHms(...)` 调用。

---

## 六、验证记录

| 验证 | 样本 | 结果 |
|---|---|---|
| 公元后 1900–2100（含分钟） | 2000 随机 + 17 边界 | 与 Java 基准 100% 一致 |
| 节气三分支（1500–2200） | 各年份段 | 正常 |
| 公元前 −1 ~ −5000 | 20000 随机 | 0 崩溃、0 undefined |
| 修正后月柱 vs 数值版 | 10000 组 | 一致 |
| JD 连续性 | 公元前 4718 年逐日 | 相邻差 1，公元前 4713-01-01=JD 0 |
| 浏览器实测 | — | `2026-08-27 16:37 → 丙午 丙申 癸酉 庚申`，无报错 |

验证工具：Java 版 lunar 库生成基准 JSON → node 交叉对比。临时脚本在 `/tmp/tyme-check/`（verify-*.js、baseline.json、random.json 等）。

---

## 七、后续维护注意事项

1. **升级 lunar.js 时**：官方库升级后需**重新打 2 处补丁**（`_computeMonth` 数值比较 + `_computeDay` 取正模）。补丁处有 `// 修正:` 注释，可 grep 定位。
2. **版本号联动**：改了 lunar.js/app.js 要同步 `sw.js` 的 `VER`（当前 v69）和 PRECACHE 清单。
3. **别换 tyme**：除非放弃公元前需求，否则 tyme4ts 用不了（坑 4）。
4. **放宽范围可选承明**：若未来只做到公元前 720 年，可评估 `@yhjs/bazi`（八字更全：大运/神煞）。
5. **验证负年份别用格里历直觉**（坑 5），用节气时刻 JD 数值判断。
