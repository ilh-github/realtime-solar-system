/**
 * SPK 坐标变换 — ICRF 赤道系 → J2000 黄道系 + SSB → 日心
 *
 * SPK 内核输出 ICRF 赤道系（近似 J2000 赤道系，差 ~0.02″，可视化可忽略）。
 * 本项目渲染使用 J2000 黄道系（Z 轴朝北，XY 平面为黄道面）。
 *
 * 变换步骤：
 *   1. ICRF 赤道 → J2000 黄道：绕 X 轴旋转 ε_A（黄赤交角）
 *   2. SSB 原点 → 日心原点：减去太阳的 SSB 位置
 */
(function () {
  'use strict';

  // J2000 平黄赤交角（IAU 1976, 84381.448″）
  // ε_A = 23° 26' 21.448" = 23.439291111°
  const OBLIQUITY_J2000 = 23.439291111 * Math.PI / 180.0;
  const COS_OBL = Math.cos(OBLIQUITY_J2000);
  const SIN_OBL = Math.sin(OBLIQUITY_J2000);

  /**
   * ICRF 赤道坐标 → J2000 黄道坐标。
   * 绕 X 轴（春分点方向）旋转 ε_A 角。
   * @param {number[]} eq - [x, y, z] 赤道坐标 (km)
   * @returns {number[]} [x', y', z'] 黄道坐标 (km)
   */
  function icrfToEcliptic(eq) {
    const x = eq[0];
    const y = eq[1];
    const z = eq[2];
    return [
      x,
      y * COS_OBL + z * SIN_OBL,
      -y * SIN_OBL + z * COS_OBL
    ];
  }

  /**
   * ICRF 赤道速度 → J2000 黄道速度。
   * 同一旋转矩阵。
   * @param {number[]} eq - [vx, vy, vz] 赤道速度 (km/s)
   * @returns {number[]} [vx', vy', vz'] 黄道速度 (km/s)
   */
  function icrfVelToEcliptic(eq) {
    return icrfToEcliptic(eq); // 旋转矩阵相同
  }

  /**
   * 太阳系质心 (SSB) 坐标 → 日心坐标。
   * @param {number[]} ssbPos - 目标的 SSB 位置 [x,y,z] (km)
   * @param {number[]} sunSsb - 太阳的 SSB 位置 [x,y,z] (km)
   * @returns {number[]} 日心位置 [x,y,z] (km)
   */
  function ssbToHeliocentric(ssbPos, sunSsb) {
    return [
      ssbPos[0] - sunSsb[0],
      ssbPos[1] - sunSsb[1],
      ssbPos[2] - sunSsb[2]
    ];
  }

  /**
   * 从 SPK 状态向量 (SSB, ICRF) 变换为日心黄道坐标。
   * @param {number[]} state - [x,y,z,vx,vy,vz] SSB ICRF
   * @param {number[]} sunState - 太阳的 SSB 状态 [x,y,z,vx,vy,vz]
   * @returns {number[]} [x,y,z,vx,vy,vz] 日心黄道
   */
  function ssbIcrfToHeliocentricEcl(state, sunState) {
    const helEq = [
      state[0] - sunState[0],
      state[1] - sunState[1],
      state[2] - sunState[2]
    ];
    const helVel = [
      state[3] - sunState[3],
      state[4] - sunState[4],
      state[5] - sunState[5]
    ];
    return [
      ...icrfToEcliptic(helEq),
      ...icrfVelToEcliptic(helVel)
    ];
  }

  // 暴露全局
  window.SPK_COORD = {
    OBLIQUITY_J2000,
    icrfToEcliptic,
    icrfVelToEcliptic,
    ssbToHeliocentric,
    ssbIcrfToHeliocentricEcl
  };
})();
