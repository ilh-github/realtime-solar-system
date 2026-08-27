# 分析记录

这里保存每轮对星历算法、数据来源、误差验证和实现决策的记录，不与项目原有的 `docs/` 截图目录混用。

命名约定：`analysis-YYYYMMDD-topic.md`。每次分析新建唯一文件，验证结果和未解决限制写在同一份记录中，避免覆盖历史结论。

当前记录：

- `analysis-20260821-ephemeris.md`：初始星历梳理与历史日期输入改造。
- `analysis-20260821-timescale-validation.md`：UTC/CST、TT、`ΔT` 与 HORIZONS 对照。
- `analysis-20260821-audit.md`：完整审计、本轮修复和遗留边界。
- `analysis-20260821-core-three-body.md`：核心三体首屏收敛、日心/地心视轨和下一阶段交接。
- `analysis-20260826-current-three-body.md`：2026-08-26 当前日期三体输出、数据依据与精度边界复核。
- `analysis-20260826-regression-and-horizons.md`：2026-08-26 回归基线、时间合同、地心模式与首例当前日期 HORIZONS 对照。
- `analysis-20260826-time-module-audit.md`：跨页面时间模块审计与统一方案（P1 第一步，只读）。
- `analysis-20260826-precision-options.md`：太阳/地球/月球精度三方案评估（DE440 体积/许可/参考系/双轨制，只读）。
- `analysis-20260827-ganzhi-bazi.md`：干支/八字功能——选型决策（lunar-javascript vs tyme 等全生态对比）、八字算法口径、6 个踩坑记录与验证结果。
