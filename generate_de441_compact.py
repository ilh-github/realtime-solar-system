#!/usr/bin/env python3
"""
从 JPL DE441 星历 bsp 提取天体 SSB 绝对坐标，生成分级步长紧凑格式 v2（供 spk-parser.js 三次样条插值）。

用法:
  python generate_de441_compact.py <input.bsp> <output.bin> [range_years]

格式 v2（多 segment，段内均匀步长，时间正序连续）:
  Header (28B): magic(4)=0x44453434, n_bodies(4), pad(4), jd_start_ms(8), jd_end_ms(8)
  Per body: naif_id(i32), n_segments(i32), 然后 n_segments 段:
    每段: n_epochs(i32), step_days(i32), seg_start_ms(i64), float32[n_epochs*3]
"""
import sys
import os
import struct
import numpy as np
from jplephem.spk import SPK

J2000 = 2451545.0
NEAR_LIMIT_YEARS = 150.0
# 公元前 5000 ~ 公元 5000（天文纪年），非对称
JD_START = J2000 - 7000 * 365.25   # -105205 (公元前 5000)
JD_END   = J2000 + 3000 * 365.25   # 3547295 (公元 5000)

# Per-body 步长表: naif_id -> (near_step_days, far_step_days)
# 近期 = |Δt| ≤ 150 年, 远期 = 150 年 < |Δt| ≤ 5000 年
STEP_TABLE = {
    10:  (7,  30),   # 太阳
    1:   (2,  4),    # 水星
    2:   (7,  15),   # 金星
    3:   (7,  15),   # EMB
    4:   (7,  15),   # 火星
    5:   (7,  30),   # 木星
    6:   (7,  30),   # 土星
    7:   (7,  30),   # 天王星
    8:   (7,  30),   # 海王星
    9:   (7,  30),   # 冥王星
    301: (1,  4),    # 月球
    399: (1,  7),    # 地球
}

BODIES = [
    (10, 'sun'), (1, 'mercury'), (2, 'venus'), (3, 'emb'), (4, 'mars'),
    (5, 'jupiter'), (6, 'saturn'), (7, 'uranus'), (8, 'neptune'),
    (9, 'pluto'), (301, 'moon'), (399, 'earth'),
]
MOON_EARTH = {301, 399}


def find_segment(kernel, center, target, jd):
    """遍历所有 segment 找覆盖 jd 的段（de441 每天体 2 段）。"""
    for seg in kernel.segments:
        if seg.center == center and seg.target == target:
            if seg.start_jd <= jd <= seg.end_jd:
                return seg
    raise KeyError(f"no segment {center}->{target} covering JD {jd}")


def ssb_position(kernel, naif, jd):
    """计算天体在 SSB ICRF 赤道系的位置（km）。"""
    if naif in MOON_EARTH:
        emb = find_segment(kernel, 0, 3, jd).compute(jd)
        rel = find_segment(kernel, 3, naif, jd).compute(jd)
        return emb + rel
    return find_segment(kernel, 0, naif, jd).compute(jd)


def build_segments(naif, jd_start, jd_end):
    """为指定天体生成时间正序、无重叠的分段列表。

    3 段:
      [jd_start .. -150y] far_step
      [-150y    .. +150y] near_step  (J2000 在段中间)
      [+150y    .. jd_end] far_step
    """
    near_step, far_step = STEP_TABLE[naif]
    near_limit_days = NEAR_LIMIT_YEARS * 365.25

    # 段边界（天数 offset from J2000），不含 0.0 切分点
    boundaries = [
        (jd_start - J2000),
        -near_limit_days,
        near_limit_days,
        (jd_end - J2000),
    ]

    segs = []
    for i in range(len(boundaries) - 1):
        a_days, b_days = boundaries[i], boundaries[i + 1]
        if b_days - a_days < 1e-9:
            continue
        # 选择步长：近期段用 near_step，其余用 far_step
        ad_max = max(abs(a_days), abs(b_days))
        if ad_max > near_limit_days:
            step = far_step
        else:
            step = near_step

        a_jd = J2000 + a_days
        b_jd = J2000 + b_days
        # 保证覆盖端点
        start = np.ceil(a_jd / step) * step
        jd_list = np.arange(start, b_jd + step * 0.5, step)
        if len(jd_list) >= 2:
            segs.append((float(jd_list[0]), int(step), jd_list))
    return segs


def main():
    if len(sys.argv) < 3:
        print("用法: python generate_de441_compact.py <input.bsp> <output.bin>")
        sys.exit(1)

    src, dst = sys.argv[1], sys.argv[2]
    kernel = SPK.open(src)
    print(f"输入: {src} | segments={len(kernel.segments)} | 范围 公元前5000~公元5000")

    jd_start = JD_START
    jd_end = JD_END

    blobs = []
    for naif, key in BODIES:
        segs = build_segments(naif, jd_start, jd_end)
        blob = struct.pack('<ii', naif, len(segs))
        total = 0
        for seg_start, step, jd_list in segs:
            n = len(jd_list)
            pos = np.empty((n, 3), dtype=np.float32)
            for j, jd in enumerate(jd_list):
                pos[j] = ssb_position(kernel, naif, float(jd))
            blob += struct.pack('<iiq', n, step, int(round(seg_start * 1000)))
            blob += pos.tobytes()
            total += n
        blobs.append(blob)
        print(f"  {key:8s} naif={naif:4d} segs={len(segs)} epochs={total}")

    with open(dst, 'wb') as f:
        f.write(struct.pack('<I', 0x44453434))
        f.write(struct.pack('<I', len(blobs)))
        f.write(struct.pack('<I', 0))
        f.write(struct.pack('<q', int(round(jd_start * 1000))))
        f.write(struct.pack('<q', int(round(jd_end * 1000))))
        for b in blobs:
            f.write(b)
    print(f"输出: {dst} | {os.path.getsize(dst) / 1e6:.1f} MB")


if __name__ == '__main__':
    main()
