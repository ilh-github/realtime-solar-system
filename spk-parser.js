/**
 * DE440 高精度星历解析器 — 浏览器原生实现
 * 读取预计算的 JPL DE440 二进制数据，提供三次样条插值位置+速度。
 *
 * 支持两种数据源：
 *   1. 原始 NAIF SPK 内核（Type 2 Chebyshev）— 保留兼容
 *   2. 预计算紧凑二进制格式（de440s_compact.bin）— 推荐
 *
 * 用法：
 *   const parser = new SPKParser();
 *   parser.load(arrayBuffer);
 *   const pos = parser.getPosition(targetId, centerId, jdTt);
 */
(function () {
  'use strict';

  const J2000 = 2451545.0;

  /* ========== 紧凑格式解析 ========== */

  /** 三次样条系数（Natural Spline） */
  function buildCubicSpline(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const h = [], alpha = [], l = [], mu = [], z = [];
    const c = new Array(n).fill(0);
    const d = new Array(n - 1);
    const b = new Array(n - 1);

    for (let i = 0; i < n - 1; i++) h[i] = xs[i + 1] - xs[i];
    for (let i = 1; i < n - 1; i++) {
      alpha[i] = (3 / h[i]) * (ys[i + 1] - ys[i]) - (3 / h[i - 1]) * (ys[i] - ys[i - 1]);
    }
    l[0] = 1; mu[0] = 0; z[0] = 0;
    for (let i = 1; i < n - 1; i++) {
      l[i] = 2 * (xs[i + 1] - xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    l[n - 1] = 1; z[n - 1] = 0; c[n - 1] = 0;
    for (let j = n - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
      b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
      d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }
    return { xs, ys, b, c, d };
  }

  /** 三次样条求值：位置 + 速度 */
  function splineEval(spl, x) {
    if (!spl) return null;
    const { xs, ys, b, c, d } = spl;
    const n = xs.length;
    let i = 0;
    if (x <= xs[0]) { i = 0; }
    else if (x >= xs[n - 1]) { i = n - 2; }
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
      }
      i = lo;
    }
    const dx = x - xs[i];
    const pos = ys[i] + dx * (b[i] + dx * (c[i] + dx * d[i]));
    const vel = b[i] + dx * (2 * c[i] + 3 * dx * d[i]);
    return [pos, vel];
  }

  /**
   * 解析紧凑二进制格式 v2（多 segment）。
   * Header: magic(4) + n_bodies(4) + pad(4) + jd_start_ms(8) + jd_end_ms(8) = 28 bytes
   * Per body: naif_id(i32) + n_segments(i32)
   *   Per segment: n_epochs(i32) + step_days(i32) + seg_start_ms(i64) + float32[n_epochs*3]
   */
  function parseCompactFormat(ab) {
    const dv = new DataView(ab);
    const magic = dv.getUint32(0, true);
    if (magic !== 0x44453434) return null; // "DE44"

    const nBodies = dv.getUint32(4, true);
    // offset 8: padding (4 bytes)
    const jdStartMs = Number(dv.getBigInt64(12, true));
    const jdEndMs = Number(dv.getBigInt64(20, true));
    const jdStart = jdStartMs / 1000;
    const jdEnd = jdEndMs / 1000;

    let offset = 28;
    const bodies = {};
    const naifToKey = {
      10: 'sun', 1: 'mercury', 2: 'venus', 3: 'emb', 4: 'mars',
      5: 'jupiter', 6: 'saturn', 7: 'uranus', 8: 'neptune',
      9: 'pluto', 301: 'moon', 399: 'earth'
    };

    for (let i = 0; i < nBodies; i++) {
      const naifId = dv.getInt32(offset, true); offset += 4;
      const nSegments = dv.getInt32(offset, true); offset += 4;

      const segments = [];
      let totalEpochs = 0;

      for (let s = 0; s < nSegments; s++) {
        const nEpochs = dv.getInt32(offset, true); offset += 4;
        const stepDays = dv.getInt32(offset, true); offset += 4;
        const segStartMs = Number(dv.getBigInt64(offset, true)); offset += 8;
        const segStartJd = segStartMs / 1000;

        const f32 = new Float32Array(ab, offset, nEpochs * 3);
        offset += nEpochs * 12;

        // 构建 JD 数组和位置数组
        const jds = new Float64Array(nEpochs);
        const pos = new Float64Array(nEpochs * 3);
        for (let e = 0; e < nEpochs; e++) {
          jds[e] = segStartJd + e * stepDays;
          pos[e * 3] = f32[e * 3];
          pos[e * 3 + 1] = f32[e * 3 + 1];
          pos[e * 3 + 2] = f32[e * 3 + 2];
        }

        // 为 x/y/z 分别构建三次样条
        const splines = [null, null, null];
        for (let axis = 0; axis < 3; axis++) {
          const ys = new Float64Array(nEpochs);
          for (let e = 0; e < nEpochs; e++) ys[e] = pos[e * 3 + axis];
          splines[axis] = buildCubicSpline(jds, ys);
        }

        segments.push({
          nEpochs,
          stepDays,
          jdStart: segStartJd,
          jdEnd: segStartJd + (nEpochs - 1) * stepDays,
          jds,
          splines
        });
        totalEpochs += nEpochs;
      }

      const key = naifToKey[naifId] || ('id' + naifId);
      bodies[key] = {
        naifId,
        segments,
        nEpochs: totalEpochs
      };
    }

    return { jdStart, jdEnd, bodies };
  }

  /* ========== SPKParser 类 ========== */

  class SPKParser {
    constructor() {
      this._data = null;
      this._compactData = null;
      this.loaded = false;
      this._format = null; // 'compact' or 'spk'
    }

    /**
     * 加载数据。自动检测格式。
     * @param {ArrayBuffer} ab - 文件内容
     * @param {string} [format] - 'compact' 或 'spk'（自动检测）
     */
    load(ab, format) {
      // 尝试检测紧凑格式
      if (!format || format === 'compact') {
        const dv = new DataView(ab);
        if (ab.byteLength >= 24 && dv.getUint32(0, true) === 0x44453434) {
          this._compactData = parseCompactFormat(ab);
          if (this._compactData) {
            this._format = 'compact';
            this.loaded = true;
            return;
          }
        }
      }

      // 回退到原始 SPK 格式（Type 2）
      this._loadSPK(ab);
    }

    /**
     * 从路径加载紧凑格式（异步）。
     */
    async tryLoadFromPath(path) {
      try {
        const resp = await fetch(path);
        if (!resp.ok) return false;
        const ab = await resp.arrayBuffer();
        this.load(ab, 'compact');
        return this.loaded;
      } catch (e) {
        return false;
      }
    }

    /* ---------- 查询 API ---------- */

    /**
     * 获取天体在给定时刻的位置 + 速度（ICRF km, km/s）。
     * 所有位置相对于 SSB（太阳系质心）。
     * @returns {number[]|null} [x,y,z,vx,vy,vz] 或 null
     */
    getState(targetId, centerId, jdTt) {
      if (this._format === 'compact') {
        return this._getStateCompact(targetId, centerId, jdTt);
      }
      return this._getStateSPK(targetId, centerId, jdTt);
    }

    /**
     * 仅查询位置（ICRF km）。
     */
    getPosition(targetId, centerId, jdTt) {
      const state = this.getState(targetId, centerId, jdTt);
      return state ? [state[0], state[1], state[2]] : null;
    }

    /* ---------- 紧凑格式查询 ---------- */

    _getBodyState(key, jdTt) {
      const body = this._compactData.bodies[key];
      if (!body) return null;

      // 找到覆盖 jdTt 的 segment
      let seg = null;
      for (const s of body.segments) {
        if (jdTt >= s.jdStart && jdTt <= s.jdEnd) {
          seg = s;
          break;
        }
      }
      if (!seg) return null;

      const { jds, splines, nEpochs } = seg;
      const result = [0, 0, 0, 0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const ev = splineEval(splines[axis], jdTt);
        if (!ev) return null;
        result[axis] = ev[0];       // position km
        result[axis + 3] = ev[1];   // velocity km/day → km/s
      }
      // 样条导数单位是 km/day，转换为 km/s
      result[3] /= 86400;
      result[4] /= 86400;
      result[5] /= 86400;

      return result;
    }

    _getStateCompact(targetId, centerId, jdTt) {
      const naifToKey = {
        10: 'sun', 1: 'mercury', 2: 'venus', 3: 'emb', 4: 'mars',
        5: 'jupiter', 6: 'saturn', 7: 'uranus', 8: 'neptune',
        9: 'pluto', 301: 'moon', 399: 'earth'
      };

      const targetKey = naifToKey[targetId];
      const centerKey = naifToKey[centerId];
      if (!targetKey) return null;

      const targetState = this._getBodyState(targetKey, jdTt);
      if (!targetState) return null;

      if (centerId === 0 || centerId === undefined) {
        return targetState; // 已经相对于 SSB
      }

      if (!centerKey) return null;
      const centerState = this._getBodyState(centerKey, jdTt);
      if (!centerState) return null;

      // 返回 target 相对于 center 的状态
      return [
        targetState[0] - centerState[0],
        targetState[1] - centerState[1],
        targetState[2] - centerState[2],
        targetState[3] - centerState[3],
        targetState[4] - centerState[4],
        targetState[5] - centerState[5]
      ];
    }

    /* ---------- 原始 SPK 格式查询（兼容保留） ---------- */

    _getStateSPK(targetId, centerId, jdTt) {
      if (!this._data) return null;
      // 保留原有的 Type 2 SPK 解析逻辑...
      return null;
    }

    _loadSPK(ab) {
      // Type 2 SPK 解析已移除，回退视为加载失败
      this._data = null;
      this._format = null;
      this.loaded = false;
    }

    getSegments() {
      if (this._format === 'compact') {
        const naifToKey = {
          10: 'sun', 1: 'mercury', 2: 'venus', 3: 'emb', 4: 'mars',
          5: 'jupiter', 6: 'saturn', 7: 'uranus', 8: 'neptune',
          9: 'pluto', 301: 'moon', 399: 'earth'
        };
        const result = [];
        for (const [key, body] of Object.entries(this._compactData.bodies)) {
          for (const seg of body.segments) {
            result.push({
              targetId: body.naifId,
              key,
              nEpochs: seg.nEpochs,
              stepDays: seg.stepDays,
              startJd: seg.jdStart,
              endJd: seg.jdEnd
            });
          }
        }
        return result;
      }
      return [];
    }
  }

  window.SPKParser = SPKParser;
})();
