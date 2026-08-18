#!/bin/sh
set -eu

# Package the working tree, not only committed files. The archive keeps
# index.html and all relative assets at its root so it can be opened directly.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$SCRIPT_DIR
OUTPUT_DIR=${1:-"$ROOT_DIR/dist"}

case "$OUTPUT_DIR" in
  /*) ;;
  *) OUTPUT_DIR=$(CDPATH= cd -- "$PWD" && pwd)/$OUTPUT_DIR ;;
esac

mkdir -p "$OUTPUT_DIR"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/realtime-solar-system.XXXXXX")
PACKAGE_NAME="realtime-solar-system-$(date +%Y%m%d-%H%M%S)"
PACKAGE_DIR="$TMP_DIR/$PACKAGE_NAME"
ARCHIVE_PATH="$OUTPUT_DIR/$PACKAGE_NAME.zip"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$PACKAGE_DIR"
rsync -a \
  --exclude '.git/' \
  --exclude 'dist/' \
  --exclude '*.zip' \
  "$ROOT_DIR/" "$PACKAGE_DIR/"

(cd "$TMP_DIR" && zip -qr "$ARCHIVE_PATH" "$PACKAGE_NAME")

printf '已生成源码包：%s\n' "$ARCHIVE_PATH"
printf '直接运行：解压后双击 index.html\n'
