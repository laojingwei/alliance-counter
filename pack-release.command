#!/bin/bash
# ============================================================
#  同盟对战 · 阵容克制关系图 —— 打包发布（macOS / Linux）
#  在 Finder 里双击本文件即可。
#
#  产物： dist/alliance-counter-v<版本号>.zip
#        zip 内是一层同名目录，结构与 GitHub 下载的 zip 一致，
#        可以直接用 update-from-zip.command 更新。
#
#  打包时排除： .git、node_modules、dist、.tmp、以及所有 zip
# ============================================================

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

echo "============================================================"
echo "  同盟对战 · 阵容克制关系图   打包发布"
echo "============================================================"
echo

if [ ! -f "index.html" ]; then
  echo "✗ 没找到 index.html，请把脚本放在项目根目录下运行。"
  echo
  read -r -p "按回车键关闭..." _
  exit 1
fi

# ---------- 1. 版本号 ----------
VER=""
if [ -f "version.json" ]; then
  VER="$(grep -o '"version"[^,]*' version.json | head -1 | sed 's/.*: *"//' | sed 's/"//')"
fi
[ -z "$VER" ] && VER="$(date +%Y%m%d)"

FOLDER="alliance-counter-v$VER"
DIST="$ROOT/dist"
ZIPOUT="$DIST/$FOLDER.zip"

echo "版本号： v$VER"
echo "产物：   $ZIPOUT"
echo

mkdir -p "$DIST"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# ---------- 2. 收集文件（排除不该带的东西） ----------
echo "正在收集文件 ..."
mkdir -p "$TMP/$FOLDER"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
        --exclude '.tmp' --exclude '*.zip' "$ROOT/" "$TMP/$FOLDER/"
else
  for item in "$ROOT"/* "$ROOT"/.[!.]*; do
    [ -e "$item" ] || continue
    base="$(basename "$item")"
    case "$base" in
      .git|node_modules|dist|.tmp|*.zip) continue ;;
    esac
    cp -R "$item" "$TMP/$FOLDER/"
  done
fi

FILE_COUNT="$(find "$TMP/$FOLDER" -type f | wc -l | tr -d ' ')"
SIZE_MB="$(du -sm "$TMP/$FOLDER" 2>/dev/null | cut -f1)"
echo "✔ 共 $FILE_COUNT 个文件，约 ${SIZE_MB:-?} MB"
echo

# ---------- 3. 压缩 ----------
echo "正在压缩 ..."
if command -v zip >/dev/null 2>&1; then
  rm -f "$ZIPOUT"
  ( cd "$TMP" && zip -qr "$ZIPOUT" "$FOLDER" )
else
  echo "✗ 没有找到 zip 命令，无法打包。"
  read -r -p "按回车键关闭..." _
  exit 2
fi

ZIP_MB="$(du -sm "$ZIPOUT" | cut -f1)"

# ---------- 4. 附一份说明 ----------
cat > "$DIST/更新说明.txt" <<EOF
同盟对战 · 阵容克制关系图   离线更新包 v$VER

【怎么用】
1. 把 $FOLDER.zip 放到你本地的该项目目录下
   （就是含有 index.html 的那个文件夹，放 dist 子目录也可以）
2. 双击 update-from-zip.command
   （Windows 用户则是把 zip 拖到 update-from-zip.cmd 上松手，更省事）
3. 脚本会自动解压并覆盖，然后刷新浏览器（Cmd+Shift+R）即可

【脚本会自动做的三件事】
- 更新前把整个目录备份到旁边的 <目录名>-backup-<时间>，出问题可以还原
- 保留 samples 目录（里面的示例 CSV 不动）
- 保留 index.html 里的 data-repo 配置

打包时间： $(date '+%Y-%m-%d %H:%M:%S')
EOF

echo "------------------------------------------------------------"
echo "✔ 打包完成"
echo "------------------------------------------------------------"
echo "zip：  $ZIPOUT  （约 ${ZIP_MB} MB）"
echo "说明： $DIST/更新说明.txt"
echo
echo "把那个 zip 发给别人即可。"
echo
read -r -p "按回车键关闭..." _
exit 0
