#!/usr/bin/env bash
# =============================================================================
# 实时太阳系 · 离线静态打包脚本
# -----------------------------------------------------------------------------
# 用途：把当前项目打成一个【零外部依赖】的自包含静态包，可直接拷进
#       Spring Boot 项目的 src/main/resources/static 目录，由 jar 直接对外服务，
#       全程不访问任何 CDN / 外网（textures 已 base64 内联，内核已本地化）。
#
# 用法：
#   ./package_static.sh [输出目录] [选项]
#
#   输出目录        默认 build/solar-system-static
#   --no-sw          不打包 service worker（并清空 index.html 里的注册代码）。
#                    适用于纯 HTTP / 内网部署，避免 SW 陈旧缓存导致重新部署不生效。
#   --no-launch-site 不打包 launch_site.html（参观航天发射基地单页，约 35MB）。
#   --zip            打包完成后额外生成一个 build/solar-system-static-<时间戳>.zip，便于传输。
#
# 说明：
#   * 脚本位于仓库根目录，源文件按脚本所在目录定位，可在任意位置执行。
#   * 入口 index.html 里的脚本标签保留 ?v= 版本串；文件按真实文件名复制。
#     Spring Boot 的静态资源处理器会忽略查询串正常返回文件，版本串仅作缓存破除。
#   * 所有路径均为相对路径（./vendor/…、./kernels/…、动态注入的 *.js），
#     因此无论挂在 / 还是 /solar/ 子路径下都能正确解析。
#   * 服务 worker 默认打包，并在复制时把 VER 改写成构建时间戳，
#     每次重新打包都会使旧缓存失效 —— 解决 Spring Boot 重新部署后页面不更新问题。
#     SW 仅在 HTTPS 或 localhost 下生效；纯 HTTP 下浏览器自动拒绝注册，应用仍由 jar 正常服务。
# =============================================================================
set -euo pipefail

# ---------- 路径与参数 ----------
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SRC/build/solar-system-static}"

WITH_SW=1
WITH_LAUNCH=1
WITH_ZIP=0
for a in "$@"; do
  case "$a" in
    --no-sw)          WITH_SW=0 ;;
    --no-launch-site) WITH_LAUNCH=0 ;;
    --zip)            WITH_ZIP=1 ;;
  esac
done

# 受管 Python（用于跨平台文本编辑，避免 macOS/Linux sed 差异）
PY="${PYTHON:-/Users/timbl/.workbuddy/binaries/python/versions/3.13.12/bin/python3}"

# ---------- 运行时依赖清单（已通过扫描 index.html / app.js / spk-loader.js 核对）----------
# 静态 <script> 标签加载
JS_CORE=(
  app.js ephemeris-time.js lunar.js spk-parser.js spk-coord.js spk-loader.js
  assets_textures.js star_catalog.js spacecraft_data.js star_names.js constellations.js
  star_rv.js exoplanets.js deepsky_data.js deepsky.js solar_system_data.js visitors_data.js
  glb_parser.js
)
# 运行时动态注入（app.js 内 document.createElement('script')）
JS_DYNAMIC=(
  asteroids_real.js
  cz5_glb.js t3e_glb.js s5_glb.js f9_glb.js n1_glb.js exp1_glb.js ss_glb.js
)
# 直接打开的子页面（window.open）
SUB_PAGES=( moon.html moon.js sky.html sky.js )
# 内核数据（必需）：spk-loader 启动即 fetch ./kernels/de441_compact.bin
KERNEL_BIN="kernels/de441_compact.bin"
# 图片与 PWA 清单（相对引用）
ASSETS=( manifest.json og.png icon-192.png icon-512.png favicon.ico )

# ---------- 预检：源文件必须存在 ----------
missing=0
check() { [ -f "$SRC/$1" ] || { echo "  ✗ 缺少源文件: $1"; missing=1; }; }
for f in "${JS_CORE[@]}" "${JS_DYNAMIC[@]}" "${SUB_PAGES[@]}" "${ASSETS[@]}" "$KERNEL_BIN" index.html; do
  check "$f"
done
[ "$WITH_LAUNCH" -eq 1 ] && check launch_site.html
[ "$WITH_SW" -eq 1 ] && check sw.js
if [ "$missing" -ne 0 ]; then
  echo "错误：存在缺失的源文件，已中止。" >&2
  exit 1
fi

# ---------- 清理并创建输出目录 ----------
rm -rf "$OUT"
mkdir -p "$OUT/vendor" "$OUT/kernels"

# ---------- 复制 ----------
echo "==> 复制静态脚本与动态注入脚本"
for f in "${JS_CORE[@]}" "${JS_DYNAMIC[@]}"; do
  cp -p "$SRC/$f" "$OUT/$f"
done

echo "==> 复制 Three.js 打包"
cp -p "$SRC/vendor/three-bundle.min.js" "$OUT/vendor/three-bundle.min.js"

echo "==> 复制星历内核（必需，~49MB）"
cp -p "$SRC/$KERNEL_BIN" "$OUT/$KERNEL_BIN"

echo "==> 复制图片与清单"
for f in "${ASSETS[@]}"; do
  cp -p "$SRC/$f" "$OUT/$f"
done

echo "==> 复制主页面与子页面"
cp -p "$SRC/index.html" "$OUT/index.html"
for f in "${SUB_PAGES[@]}"; do
  cp -p "$SRC/$f" "$OUT/$f"
done
if [ "$WITH_LAUNCH" -eq 1 ]; then
  cp -p "$SRC/launch_site.html" "$OUT/launch_site.html"
fi

# ---------- Service Worker ----------
if [ "$WITH_SW" -eq 1 ]; then
  echo "==> 复制 service worker 并将 VER 打构建时间戳"
  cp -p "$SRC/sw.js" "$OUT/sw.js"
  STAMP="v$(date +%Y%m%d-%H%M)"
  "$PY" - "$OUT/sw.js" "$STAMP" <<'PYEOF'
import sys, re
p, stamp = sys.argv[1], sys.argv[2]
s = open(p, encoding="utf-8").read()
s2 = re.sub(r'const VER = "v\d+";', f'const VER = "{stamp}";', s, count=1)
open(p, "w", encoding="utf-8").write(s2)
print("     sw.js VER ->", stamp)
PYEOF
else
  echo "==> 已选择 --no-sw：清空 index.html 中的 SW 注册代码（不复制 sw.js）"
  "$PY" - "$OUT/index.html" <<'PYEOF'
import sys, re
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s2 = re.sub(r'<script>if \("serviceWorker".*?\.catch\(function \(\) \{\}\);</script>', '', s, flags=re.S)
open(p, "w", encoding="utf-8").write(s2)
PYEOF
fi

# ---------- 生成清单文件 ----------
MANIFEST="$OUT/PACKAGE_MANIFEST.txt"
{
  echo "实时太阳系 · 离线静态包清单"
  echo "生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "SW: $([ "$WITH_SW" -eq 1 ] && echo 启用 || echo 关闭)"
  echo "launch_site: $([ "$WITH_LAUNCH" -eq 1 ] && echo 包含 || echo 排除)"
  echo "-----"
  echo "挂载到 Spring Boot: 把本目录内容拷入 src/main/resources/static/ 即可"
  echo "入口: /  (index.html)  |  子页: /moon.html  /sky.html  /launch_site.html"
  echo "-----"
  for f in $(cd "$OUT" && find . -type f | sort); do
    sz=$(du -h "$OUT/$f" | cut -f1)
    printf "%-40s %s\n" "${f#./}" "$sz"
  done
} > "$MANIFEST"

# ---------- 可选 zip ----------
if [ "$WITH_ZIP" -eq 1 ]; then
  ZIP="$SRC/build/solar-system-static-$(date +%Y%m%d-%H%M).zip"
  echo "==> 生成 zip: $ZIP"
  ( cd "$OUT" && "$PY" - "$ZIP" <<'PYEOF'
import sys, zipfile, os
zp = sys.argv[1]
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk("."):
        for fn in files:
            fp = os.path.join(root, fn)
            z.write(fp, fp)
print("     zip 完成:", zp)
PYEOF
  )
fi

# ---------- 汇总 ----------
total=$(du -sh "$OUT" | cut -f1)
echo
echo "==================== 打包完成 ===================="
echo "输出目录: $OUT"
echo "包总大小: $total"
echo "清单文件: $MANIFEST"
echo
echo "部署到 Spring Boot（二选一，注意保留子目录 vendor/ 与 kernels/）："
echo "  cp -r \"$OUT/.\" /你的项目/src/main/resources/static/"
echo "  # 或仅放到子路径："
echo "  mkdir -p /你的项目/src/main/resources/static/solar && cp -r \"$OUT/.\" /你的项目/src/main/resources/static/solar/"
echo
echo "访问："
echo "  http://localhost:8080/            （根挂载）"
echo "  http://localhost:8080/solar/      （子路径挂载，相对路径自动适配）"
echo
if [ "$WITH_SW" -eq 1 ]; then
  echo "注意：Service Worker 仅在 HTTPS 或 localhost 生效；纯 HTTP 内网会自动跳过注册，"
  echo "      应用仍由 jar 正常服务。重新部署后访问 / 即可拿到新版本（VER 已打时间戳）。"
else
  echo "注意：已关闭 SW，页面始终由 jar 直接服务，重新部署立即生效；代价是关掉了真·离线缓存。"
fi
echo "=================================================="
