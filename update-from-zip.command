#!/bin/bash
# ============================================================
#  同盟对战 · 阵容克制关系图 —— 用本地 zip 包更新（macOS / Linux）
#  给连不上 GitHub 的人用：手动下载 zip，放到项目目录后运行本脚本。
#
#  用法（任选其一）：
#    1) 把 zip 放到项目根目录（或 dist/ 目录），双击本文件
#    2) 终端里执行： ./update-from-zip.command /path/to/xxx.zip
#
#  与联网更新一致的安全措施：
#    · 更新前整目录备份到旁边的 <目录名>-backup-<时间>
#    · 保留 samples/ 目录
#    · 保留 index.html 里的 data-repo 配置
# ============================================================

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
REPO_NAME="$(basename "$ROOT")"

echo "============================================================"
echo "  同盟对战 · 阵容克制关系图   用本地 zip 更新"
echo "============================================================"
echo

# ---------- 1. 找 zip ----------
ZIP="${1:-}"
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then
  ZIP=""
  for d in "$ROOT" "$ROOT/dist"; do
    [ -d "$d" ] || continue
    hit="$(ls -t "$d"/*.zip 2>/dev/null | head -1)"
    if [ -n "$hit" ]; then ZIP="$hit"; break; fi
  done
fi

if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then
  echo "✗ 没找到 zip 更新包。"
  echo
  echo "  用法（任选一种）："
  echo "   1) 把下载好的 zip 放到项目根目录（或 dist/ 目录），再双击本脚本；"
  echo "   2) 终端执行： ./update-from-zip.command /路径/xxx.zip"
  echo
  read -r -p "按回车键关闭..." _
  exit 1
fi

echo "更新包： $ZIP"
echo "大小：   $(du -h "$ZIP" | cut -f1)"
echo

# ---------- 2. 解压 ----------
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "正在解压 ..."
if ! unzip -q "$ZIP" -d "$TMP"; then
  echo "✗ 解压失败，zip 可能不完整，重新下载一次试试。"
  read -r -p "按回车键关闭..." _
  exit 2
fi

# zip 一般有一层目录
ENTRIES="$(find "$TMP" -maxdepth 1 -mindepth 1 | wc -l | tr -d ' ')"
if [ "$ENTRIES" = "1" ] && [ -d "$(find "$TMP" -maxdepth 1 -mindepth 1 | head -1)" ]; then
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 | head -1)"
else
  SRC="$TMP"
fi

if [ ! -f "$SRC/index.html" ]; then
  echo "✗ 这个 zip 里没找到 index.html，不像是本项目的更新包。"
  echo "  解压后的目录： $SRC"
  read -r -p "按回车键关闭..." _
  exit 2
fi
echo "✔ 解压完成： $(basename "$SRC")"

SRC_VER=""
[ -f "$SRC/version.json" ] && SRC_VER="$(grep -o '"version"[^,]*' "$SRC/version.json" | head -1 | sed 's/.*: *"//' | sed 's/"//')"
CUR_VER=""
[ -f "$ROOT/version.json" ] && CUR_VER="$(grep -o '"version"[^,]*' "$ROOT/version.json" | head -1 | sed 's/.*: *"//' | sed 's/"//')"
[ -n "$SRC_VER" ] && echo "  包内版本： v$SRC_VER   （当前： v${CUR_VER:-未知}）"
echo

# ---------- 3. 备份 ----------
BACKUP="$(dirname "$ROOT")/${REPO_NAME}-backup-${STAMP}"
echo "正在备份到： $BACKUP"
cp -R "$ROOT" "$BACKUP"
echo "✔ 备份完成（出问题可以从这里还原）"
echo

# ---------- 4. 记录配置 ----------
KEEP_REPO=""
if [ -f "$ROOT/index.html" ]; then
  KEEP_REPO="$(grep -o 'data-repo="[^"]*"' "$ROOT/index.html" | head -1 | sed 's/data-repo="//' | sed 's/"$//')"
fi

# ---------- 5. 覆盖（保留 samples 与 .git） ----------
echo "正在覆盖文件 ..."
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude 'samples' --exclude '.git' "$SRC/" "$ROOT/"
else
  for item in "$SRC"/* "$SRC"/.[!.]*; do
    [ -e "$item" ] || continue
    base="$(basename "$item")"
    case "$base" in
      samples|.git) continue ;;
    esac
    cp -R "$item" "$ROOT/"
  done
fi
echo "✔ 文件覆盖完成"
echo

# ---------- 6. 写回 data-repo ----------
if [ -n "$KEEP_REPO" ] && [ -f "$ROOT/index.html" ]; then
  sed -i.bak 's|data-repo="[^"]*"|data-repo="'"$KEEP_REPO"'"|' "$ROOT/index.html" && rm -f "$ROOT/index.html.bak"
  echo "✔ 已保留你的仓库地址配置"
fi

echo
echo "------------------------------------------------------------"
echo "✔ 更新完成（本地 zip 方式）"
echo "------------------------------------------------------------"
echo "请刷新浏览器页面（Cmd+Shift+R）查看新版本。"
echo "备份位置： $BACKUP"
echo "确认一切正常后，可以手动删掉这个备份目录和用过的 zip。"
echo
read -r -p "按回车键关闭..." _
exit 0
