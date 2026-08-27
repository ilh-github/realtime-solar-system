/* =========================================================================
 * 实时太阳系 · 公共时间模块 (ephemeris-time.js)
 * 目的: index.html / sky.html / moon.html 等页面统一使用同一套
 *       民用时间 <-> 儒略日 <-> TT 时间尺度转换, 消除各页面自带的
 *       ΔT 近似实现分叉 (见 analysis-records/analysis-20260826-time-module-audit.md)。
 * 时间合同:
 *   - 民用输入 (UTC/CST 或任意时区偏移) -> UTC JD -> deltaTSecondsForJd -> TT JD
 *   - 位置计算函数 (三体/轨道) 只接受 TT JD
 *   - 地面观星等以 UT 为输入/显示的页面, 消费 UTC JD, 内部自行转 TT
 *   - ΔT = TT - UT1, 使用 NASA/Espenak 分段多项式近似 (UT1 以 UTC 近似),
 *     历史日期为估计值, 不代表地球自转观测
 * 无任何依赖; 挂载到 window.EPHEMERIS_TIME (非浏览器环境挂 globalThis)。
 * ========================================================================= */
(function (globalTarget) {
  "use strict";

  const GREGORIAN_SWITCH_JD = 2299160.5; // 1582-10-15 00:00 UTC

  function usesGregorianCalendar(year, month, day, mode) {
    if (mode === "gregorian") return true;
    if (mode === "julian") return false;
    return year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  }

  function isLeapCivilYear(year, mode) {
    const gregorian = usesGregorianCalendar(year, 3, 1, mode);
    return gregorian
      ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      : year % 4 === 0;
  }

  function daysInCivilMonth(year, month, mode) {
    if (month === 2) return isLeapCivilYear(year, mode) ? 29 : 28;
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function civilToJd(year, month, day, hour, minute, mode) {
    let y = year, m = month;
    if (m <= 2) { y -= 1; m += 12; }
    const a = Math.floor(y / 100);
    const b = usesGregorianCalendar(year, month, day, mode) ? 2 - a + Math.floor(a / 4) : 0;
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5
      + (hour * 60 + minute) / 1440;
  }

  function jdToCivil(jdValue, mode) {
    const z = Math.floor(jdValue + 0.5);
    const f = jdValue + 0.5 - z;
    const gregorian = mode === "gregorian" || (mode === "auto" && jdValue >= GREGORIAN_SWITCH_JD);
    let a = z;
    if (gregorian) {
      const alpha = Math.floor((z - 1867216.25) / 36524.25);
      a += 1 + alpha - Math.floor(alpha / 4);
    }
    const b = a + 1524;
    const c = Math.floor((b - 122.1) / 365.25);
    const d = Math.floor(365.25 * c);
    const e = Math.floor((b - d) / 30.6001);
    const dayWithFraction = b - d - Math.floor(30.6001 * e) + f;
    let month = e < 14 ? e - 1 : e - 13;
    let year = month > 2 ? c - 4716 : c - 4715;
    let day = Math.floor(dayWithFraction);
    let totalMinutes = Math.round((dayWithFraction - day) * 1440);
    if (totalMinutes >= 1440) { totalMinutes = 0; day += 1; }
    if (day > daysInCivilMonth(year, month, mode)) {
      day = 1;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    let hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return { year, month, day, hour, minute };
  }

  // NASA/Espenak polynomial approximation of ΔT = TT - UT (seconds).
  // It is sufficient for the visualizer's time-scale correction, but not a
  // replacement for historical Earth-orientation observations.
  function deltaTSecondsForYear(year) {
    const y = year;
    let u, t;
    if (y < -500) {
      u = (y - 1820) / 100;
      return -20 + 32 * u * u;
    }
    if (y < 500) {
      u = y / 100;
      return 10583.6 - 1014.41 * u + 33.78311 * u * u - 5.952053 * u ** 3
        - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
    }
    if (y < 1600) {
      u = (y - 1000) / 100;
      return 1574.2 - 556.01 * u + 71.23472 * u * u + 0.319781 * u ** 3
        - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
    }
    if (y < 1700) {
      t = y - 1600;
      return 120 - 0.9808 * t - 0.01532 * t * t + t ** 3 / 7129;
    }
    if (y < 1800) {
      t = y - 1700;
      return 8.83 + 0.1603 * t - 0.0059285 * t * t + 0.00013336 * t ** 3 - t ** 4 / 1174000;
    }
    if (y < 1860) {
      t = y - 1800;
      return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3
        - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6
        + 0.000000000875 * t ** 7;
    }
    if (y < 1900) {
      t = y - 1860;
      return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3
        - 0.0004473624 * t ** 4 + t ** 5 / 233174;
    }
    if (y < 1920) {
      t = y - 1900;
      return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
    }
    if (y < 1941) {
      t = y - 1920;
      return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3;
    }
    if (y < 1961) {
      t = y - 1950;
      return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547;
    }
    if (y < 1986) {
      t = y - 1975;
      return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718;
    }
    if (y < 2005) {
      t = y - 2000;
      return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
        + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
    }
    if (y < 2050) {
      t = y - 2000;
      return 62.92 + 0.32217 * t + 0.005589 * t ** 2;
    }
    if (y < 2150) {
      return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
    }
    u = (y - 1820) / 100;
    return -20 + 32 * u * u;
  }

  function deltaTSecondsForJd(jdValue) {
    const p = jdToCivil(jdValue, "auto");
    return deltaTSecondsForYear(p.year + (p.month - 0.5) / 12);
  }

  function utcJdToTtJd(jdUtc) {
    return jdUtc + deltaTSecondsForJd(jdUtc) / 86400;
  }

  function currentUtcJd() {
    return 2440587.5 + Date.now() / 86400000;
  }

  function currentTtJd() {
    return utcJdToTtJd(currentUtcJd());
  }

  function ttJdToUtcJd(jdTt) {
    let jdUtc = jdTt - deltaTSecondsForJd(jdTt) / 86400;
    // One correction step handles the slow variation of ΔT across a date.
    jdUtc = jdTt - deltaTSecondsForJd(jdUtc) / 86400;
    return jdUtc;
  }

  function parseDateToTtJd(value, zoneHours, mode) {
    const match = /^([+-]?\d{1,6})-(\d{2})-(\d{2})[T ](\d{2})(?::(\d{2}))?$/.exec(String(value || "").trim());
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const hour = Number(match[4]), minute = Number(match[5] || 0);
    if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    if (mode === "auto" && year === 1582 && month === 10 && day >= 5 && day <= 14) return null;
    const localJd = civilToJd(year, month, day, hour, minute, mode);
    const roundTrip = jdToCivil(localJd, mode);
    if (roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day
      || roundTrip.hour !== hour || roundTrip.minute !== minute) return null;
    return utcJdToTtJd(localJd - zoneHours / 24);
  }

  function jdFromUnixMs(ms) { return ms / 86400000 + 2440587.5; }
  function unixMsFromJd(jd) { return (jd - 2440587.5) * 86400000; }

  globalTarget.EPHEMERIS_TIME = {
    GREGORIAN_SWITCH_JD,
    usesGregorianCalendar,
    isLeapCivilYear,
    daysInCivilMonth,
    civilToJd,
    jdToCivil,
    deltaTSecondsForYear,
    deltaTSecondsForJd,
    utcJdToTtJd,
    ttJdToUtcJd,
    currentUtcJd,
    currentTtJd,
    parseDateToTtJd,
    jdFromUnixMs,
    unixMsFromJd
  };
})(typeof window !== "undefined" ? window : globalThis);
