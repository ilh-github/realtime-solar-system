#!/bin/bash
# ============================================================
# 太阳系可视化 — 星历数据下载与生成脚本 (macOS/Linux)
# 用法: bash setup_kernels.sh
# 依赖: curl, python3 (需 numpy + jplephem)
# ============================================================
set -e

KERNELS_DIR="kernels"
DE441_URL="https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de441.bsp"
DE441_BSP="$KERNELS_DIR/de441.bsp"
DE441_BIN="$KERNELS_DIR/de441_compact.bin"

echo "========================================"
echo " 太阳系可视化 · 星历数据初始化"
echo "========================================"

# 检查 Python 环境（优先用项目 venv）
PYTHON=""
if [ -f "/Users/timbl/.workbuddy/binaries/python/envs/default/bin/python" ]; then
  PYTHON="/Users/timbl/.workbuddy/binaries/python/envs/default/bin/python"
elif command -v python3 &>/dev/null; then
  PYTHON=python3
elif command -v python &>/dev/null; then
  PYTHON=python
else
  echo "❌ 未找到 python，请先安装 Python 3"
  exit 1
fi
echo "Python: $PYTHON ($($PYTHON --version 2>&1))"

# 检查依赖
$PYTHON -c "import numpy, jplephem" 2>/dev/null || {
  echo "⚠️  缺少 numpy/jplephem，正在安装..."
  $PYTHON -m pip install --user numpy jplephem 2>/dev/null || \
  $PYTHON -m pip install numpy jplephem
}

mkdir -p "$KERNELS_DIR"

# === DE441 下载 ===
if [ -f "$DE441_BIN" ]; then
  echo "✅ $DE441_BIN 已存在，跳过"
else
  if [ -f "$DE441_BSP" ] && [ "$(stat -f%z "$DE441_BSP" 2>/dev/null || stat -c%s "$DE441_BSP" 2>/dev/null)" = "3307878400" ]; then
    echo "✅ $DE441_BSP 已下载"
  else
    echo "📥 下载 DE441 星历 (3.08 GB，请耐心等待)..."
    curl -L -C - --retry 3 -o "$DE441_BSP" "$DE441_URL"
    echo "✅ 下载完成"
  fi

  echo "🔧 生成紧凑格式 (约 50 MB)..."
  $PYTHON generate_de441_compact.py "$DE441_BSP" "$DE441_BIN" 5000
  echo "✅ $DE441_BIN 生成完成"
fi

echo ""
echo "========================================"
echo " 初始化完成！可以启动 HTTP 服务了"
echo " python3 -m http.server 4185"
echo "========================================"
