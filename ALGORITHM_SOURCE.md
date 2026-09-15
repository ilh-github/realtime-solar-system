# 干支/八字算法来源说明

> 用途：向他人解释本项目「时间栏干支四柱（八字）」功能的算法与代码来源。
> 更新时间：2026-08-31

---

## 一句话总结

本项目干支/八字计算，**直接使用**开源库 `lunar-javascript`（作者 6tail，MIT 许可），其历法/节气算法的**历史源头**是许剑伟先生的《寿星天文历》（sxwnl）。我们复制了该库的代码到本地 `lunar.js`，并针对「公元前（负年份）」需求打了 3 处最小修正（月柱修复在同函数的两段节气循环中重复出现，故代码内共 4 处 `// 修正:` 标记）。

来源链条（从下到上）：

```
本项目 lunar.js（本地，带 3 处负年份补丁，代码内 4 处 // 修正: 标记）
        ▲ 复制自
lunar-javascript v1.7.7（6tail，MIT）
        ▲ 节气/农历算法源自
寿星天文历 sxwnl（许剑伟，社区开源）
```

---

## 1. 直接使用的库：lunar-javascript

| 项 | 内容 |
|---|---|
| 名称 | lunar-javascript（npm 包名同） |
| 作者 | 6tail |
| 采用版本 | v1.7.7 |
| 许可 | MIT |
| 仓库 | https://github.com/6tail/lunar-javascript |
| 在线文档 | https://6tail.cn/calendar/api.html |
| npm | https://www.npmjs.com/package/lunar-javascript |

能力：公历/农历转换、干支、生肖、二十四节气、儒略日、八字四柱等，无第三方依赖。

**本项目本地落点**：`lunar.js`（项目根目录），即该库 v1.7.7 的复制版（挂 `window.Solar / Lunar / EightChar`），另加 3 处负年份修正（见第 4 节）。

---

## 2. 算法源头：寿星天文历（sxwnl，许剑伟）

`lunar-javascript` 的节气与农历算法，历史源头是许剑伟先生的 **《寿星天文历》**（万年历，又名 sxwnl）。这是中文开源历法计算领域影响力最大的算法之一，6tail 的 lunar 系列与 tyme 系列均致谢此项目。

| 项 | 内容 |
|---|---|
| 原作者 | 许剑伟 |
| 原始发布/更新地址 | http://bbs.nongli.net/dispbbs_2_14995.html（农历论坛原帖） |
| 说明文档 | https://sxwnl.github.io/src/readme.htm |
| 版权说明 | https://sxwnl.github.io/src/sm1.htm#copyright |
| 在线预览 | https://sxwnl.github.io/ |
| GitHub 镜像（UTF-8 转码） | https://github.com/www591rmb/sxwnl |

> 注意：`sxwnl.github.io` 与上述 GitHub 仓库为社区维护的转码/镜像版本（原版为 GBK 编码）。原作者的原始发布渠道是农历论坛 `bbs.nongli.net` 的帖子。

---

## 3. 相关但未采用：tyme4ts（6tail 新一代）

6tail 作者后来推出并主推新一代库 **tyme** 系列（多语言），TypeScript 版为 **tyme4ts**：

| 项 | 内容 |
|---|---|
| 仓库 | https://github.com/6tail/tyme4ts |
| Releases | https://github.com/6tail/tyme4ts/releases |
| 作者 | 6tail |
| 未采用原因 | 仅支持公元 1 年及以后（`year <= 0` 抛 `illegal solar year`），不满足本项目「±5000 年、含公元前」的需求 |

结论：tyme4ts 虽为作者主推的升级版，但因不支持公元前，本项目**无法使用**，故仍采用支持负年份的 `lunar-javascript`。

---

## 4. 本项目本地改动（3 处负年份修正）

原版 `lunar-javascript` 对「公元前（负年份）」存在 3 类 bug（代码内共 4 处 `// 修正:` 标记，其中月柱修复在 `_computeMonth` 的两段节气循环中各出现一次），本项目已做最小修正（可在 `lunar.js` 内搜索 `// 修正:` 定位）：

1. **`_computeMonth`（月柱，行 713、731）**：改用儒略日（JD）数值比较替代字符串比较，修复公元前月柱几乎全部错成「亥月」的问题。该修复在「立春版」与「精确版」两段节气循环中各写一处，故代码内有两处 `// 修正:` 标记。
2. **`_computeDay`（日柱，行 749）**：对负 offset 取正模（`((offset % 10) + 10) % 10` 等），修复儒略日为负（公元前 4713 年前）时，日柱索引为负导致输出 `undefined`/`NaN` 的问题。
3. **`getYearInChinese`（年份中文显示，行 968）**：入参先 `if (y <= 0) y = 1 - y;` 将天文年转历史年并去除负号，修复公元前年份显示为「-N 年」、且未做「公元 0 年 = 公元前 1 年」换算的问题。

> 验证：用 Node 直接 require 本地 `lunar.js`，对现代（2024）、公元前 1 年（天文年 0）、公元前 2025 年（天文年 -2024）、公元前 5000 年（天文年 -4999）四组日期调用 `Solar.fromYmdHms(...).getLunar().getEightChar()`，八字四柱均无 `undefined`/`NaN`、农历年中文无负号，补丁生效。

除上述三处外，其余算法与官方 v1.7.7 保持一致。

---

## 5. 授权与致谢注意事项

- **直接依赖**（`lunar-javascript`）：MIT 许可，可自由使用、修改、再分发，需保留其 LICENSE 声明。
- **算法源头**（寿星天文历）：原作者声明——若在自有软件中使用了其核心算法及数据，**可以声明「数据或算法来源于寿星天文历」，也可以不声明，但不得声明为其他来源**；且不得随意修改其中的天文算法（eph）与古历部分数据/算法。
- 因此，对外解释时建议口径：「干支/节气计算基于 6tail 的 lunar-javascript（MIT），其历法算法源自许剑伟《寿星天文历》」。

---

## 6. 原始地址速查表

| 用途 | 地址 |
|---|---|
| 直接依赖库（lunar-javascript） | https://github.com/6tail/lunar-javascript |
| 直接依赖库文档 | https://6tail.cn/calendar/api.html |
| 算法源头（寿星天文历）原帖 | http://bbs.nongli.net/dispbbs_2_14995.html |
| 寿星天文历说明文档 | https://sxwnl.github.io/src/readme.htm |
| 寿星天文历版权说明 | https://sxwnl.github.io/src/sm1.htm#copyright |
| 寿星天文历 GitHub 镜像 | https://github.com/www591rmb/sxwnl |
| 新一代库 tyme4ts（未采用） | https://github.com/6tail/tyme4ts |

---

## 附：本项目内相关文件

- `lunar.js` —— 干支/八字算法本体（lunar-javascript v1.7.7 复制版 + 3 处补丁，代码内 4 处 // 修正: 标记）
- `index.html` / `app.js` —— 引入与调用（`Solar.fromYmdHms(...).getLunar().getEightChar()`）
- `analysis-records/analysis-20260827-ganzhi-bazi.md` —— 选型决策、八字算法口径、6 条踩坑与验证记录
