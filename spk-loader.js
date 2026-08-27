/**
 * SPK 加载器与集成模块 — 检测/加载/查询/降级
 *
 * 职责：
 *   1. 自动检测本地 ./kernels/de441_compact.bin 是否存在
 *   2. 支持用户通过文件选择器加载内核
 *   3. 提供与 threeBodyStateKm 完全一致的输出格式
 *   4. 在 SPK 不可用时静默降级到近似模型
 *
 * 坐标约定：
 *   - SPK 原始输出：SSB ICRF（太阳系质心，ICRF 赤道系）
 *   - 本模块输出：日心 J2000 黄道（减去太阳 SSB，旋转 ε_A）
 *   - 所有位置单位 km，速度 km/s
 *
 * 依赖：spk-parser.js (SPKParser), spk-coord.js (SPK_COORD)
 */
(function () {
  'use strict';

  // NAIF SPICE ID → 项目天体名
  const NAIF_TO_NAME = {
    1: 'Mercury', 2: 'Venus', 3: 'EMB',
    4: 'Mars', 5: 'Jupiter', 6: 'Saturn',
    7: 'Uranus', 8: 'Neptune', 9: 'Pluto',
    10: 'Sun', 301: 'Moon', 399: 'Earth'
  };

  const NAME_TO_NAIF = {};
  for (const [id, name] of Object.entries(NAIF_TO_NAME)) {
    NAME_TO_NAIF[name] = parseInt(id);
  }

  let _parser = null;
  let _available = false;
  let _statusText = '';

  async function tryLoadFromPath(path) {
    path = path || './kernels/de441_compact.bin';
    try {
      const resp = await fetch(path);
      if (!resp.ok) return false;
      const ab = await resp.arrayBuffer();
      return _loadBuffer(ab);
    } catch (e) {
      return false;
    }
  }

  async function loadFromFile(file) {
    try {
      const ab = await file.arrayBuffer();
      return _loadBuffer(ab);
    } catch (e) {
      return false;
    }
  }

  function _loadBuffer(ab) {
    try {
      _parser = new SPKParser();
      _parser.load(ab);
      if (!_parser.loaded) {
        _parser = null;
        _available = false;
        _statusText = '';
        return false;
      }
      _available = true;
      const segs = _parser.getSegments();
      const bodies = [...new Set(segs.map(s => NAIF_TO_NAME[s.targetId] || `#${s.targetId}`))];
      _statusText = `DE440 模式 (${bodies.join(', ')})`;
      return true;
    } catch (e) {
      console.warn('[SPK] 加载失败:', e.message);
      _parser = null;
      _available = false;
      _statusText = '';
      return false;
    }
  }

  function isAvailable() {
    return _available && _parser && _parser.loaded;
  }

  function getStatusText() {
    return _statusText;
  }

  /**
   * 查询天体状态向量（日心 J2000 黄道 km, km/s）。
   * @param {number} targetId - NAIF 目标 ID
   * @param {number} centerId - NAIF 中心 ID（0=SSB，10=Sun）
   * @param {number} jdTt - TT 儒略日
   * @returns {number[]|null} [x,y,z,vx,vy,vz] 日心黄道
   */
  function getStateHeliocentric(targetId, centerId, jdTt) {
    if (!isAvailable()) return null;

    // 获取目标的 SSB ICRF 状态
    const targetState = _parser.getState(targetId, 0, jdTt);
    if (!targetState) return null;

    // 获取太阳的 SSB ICRF 状态（用于转日心）
    const sunState = _parser.getState(10, 0, jdTt);
    if (!sunState) return null;

    // SSB → 日心（减去太阳位置）
    const helEq = [
      targetState[0] - sunState[0],
      targetState[1] - sunState[1],
      targetState[2] - sunState[2]
    ];
    const helVel = [
      targetState[3] - sunState[3],
      targetState[4] - sunState[4],
      targetState[5] - sunState[5]
    ];

    // ICRF 赤道 → J2000 黄道
    return [
      ...SPK_COORD.icrfToEcliptic(helEq),
      ...SPK_COORD.icrfVelToEcliptic(helVel)
    ];
  }

  function getPositionHeliocentric(targetId, centerId, jdTt) {
    const state = getStateHeliocentric(targetId, centerId, jdTt);
    return state ? [state[0], state[1], state[2]] : null;
  }

  /**
   * 三体状态查询 — 与 threeBodyStateKm 完全一致的输出格式。
   * 返回日心黄道坐标。直接使用 DE440 的 399/301 绝对坐标差分，
   * 不依赖质量比反推，保证 moonGeo = moon - earth 语义正确。
   *
   * @param {number} jdTt - TT 儒略日
   * @returns {object|null} { jdTt, sun, emb, earth, moon, moonGeo }
   */
  function getState(jdTt) {
    if (!isAvailable() || !Number.isFinite(jdTt)) return null;

    const sun = [0, 0, 0];

    // 直接取 399（地球）和 301（月球）的绝对 SSB 坐标
    const earthState = getStateHeliocentric(399, 0, jdTt);
    const moonState  = getStateHeliocentric(301, 0, jdTt);
    const embState   = getStateHeliocentric(3,   0, jdTt);
    if (!earthState || !moonState || !embState) return null;

    const earth = [earthState[0], earthState[1], earthState[2]];
    const moon  = [moonState[0],  moonState[1],  moonState[2]];
    const emb   = [embState[0],   embState[1],   embState[2]];

    // moonGeo = 月球 - 地球（日心黄道差分），与降级路径语义一致
    const moonGeo = [
      moon[0] - earth[0],
      moon[1] - earth[1],
      moon[2] - earth[2]
    ];

    return { jdTt, sun, emb, earth, moon, moonGeo };
  }

  window.SPK_LOADER = {
    tryLoadFromPath,
    loadFromFile,
    isAvailable,
    getStatusText,
    getStateHeliocentric,
    getPositionHeliocentric,
    getState,
    NAIF_TO_NAME,
    NAME_TO_NAIF
  };
})();
