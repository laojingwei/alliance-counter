#!/bin/bash
# ============================================================
#  同盟对战 · 阵容克制关系图 —— 自动更新（macOS / Linux）
#
#  用法：在 Finder 里双击本文件即可。
#        如果提示「无法打开，因为它来自身份不明的开发者」，
#        右键 -> 打开，或到「系统设置 - 隐私与安全性」里点「仍要打开」。
#
#  两种更新方式，脚本自动选择：
#    1) 目录是 git 仓库 且装了 git  -> git pull
#    2) 其它情况                    -> 下载最新 zip 覆盖
#
#  安全措施：
#    · 更新前把整个目录备份到旁边的 <目录名>-backup-<时间>
#    · 保留 samples/ 目录（里面的示例 CSV 不动）
#    · 保留你在 index.html 里填的 data-repo 配置
# ============================================================

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
REPO_NAME="$(basename "$ROOT")"

echo "============================================================"
echo "  同盟对战 · 阵容克制关系图   自动更新"
echo "============================================================"
echo

if [ ! -f "index.html" ]; then
  echo "✗ 没找到 index.html，请把本脚本放在项目根目录下运行。"
  echo
  read -r -p "按回车键关闭..." _
  exit 1
fi

# ---------- 1. 读取仓库地址（与网页共用同一处配置） ----------
REPO="$(grep -o 'data-repo="[^"]*"' index.html | head -1 | sed 's/data-repo="//' | sed 's/"$//')"

if [ -z "${REPO:-}" ] || echo "$REPO" | grep -q "YOUR-NAME"; then
  echo "✗ 还没有配置仓库地址。"
  echo
  echo "  请打开 index.html，找到这一行并把地址换成你自己的仓库："
  echo '    <body data-repo="https://github.com/你的用户名/你的仓库">'
  echo
  read -r -p "按回车键关闭..." _
  exit 1
fi

REPO="${REPO%/}"
echo "仓库地址： $REPO"
echo

# ---------- 2. 优先走 git ----------
if command -v git >/dev/null 2>&1 && [ -d ".git" ] && [ -n "$(git remote 2>/dev/null)" ]; then
  echo "[方式] 检测到 git 仓库，执行 git pull ..."
  echo
  if git pull --ff-only; then
    echo
    echo "------------------------------------------------------------"
    echo "✔ 更新完成（git 方式）"
    echo "------------------------------------------------------------"
    echo "请刷新浏览器页面（Cmd+Shift+R）查看新版本。"
    echo
    read -r -p "按回车键关闭..." _
    exit 0
  fi
  echo
  echo "! git pull 没能快进（可能有本地改动），改用「下载覆盖」方式继续。"
  echo
elif [ -d ".git" ]; then
  echo "! 这是 git 仓库，但没有配置远程仓库（remote），跳过 git 方式。"
  echo "  想用 git 更新的话： git remote add origin <你的仓库地址>"
  echo
fi

# ---------- 3. 下载 zip 覆盖 ----------
ZIP_URL="$REPO/archive/refs/heads/main.zip"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"

echo "[方式] 没有 git 仓库，改为下载最新版覆盖 ..."
echo "下载： $ZIP_URL"
echo

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

if ! curl -L --fail --silent --show-error -o "$TMP/main.zip" "$ZIP_URL"; then
  echo
  echo "✗ 下载失败。"
  echo "  常见原因：网络不通 / 访问 GitHub 受限 / 仓库地址填错 / 默认分支不是 main。"
  echo
  read -r -p "按回车键关闭..." _
  exit 3
fi
echo "✔ 下载完成"

echo "正在解压 ..."
if ! unzip -q "$TMP/main.zip" -d "$TMP"; then
  echo "✗ 解压失败。"
  read -r -p "按回车键关闭..." _
  exit 3
fi

SRC="$(find "$TMP" -maxdepth 1 -type d -name '*-main' -print -quit)"
if [ -z "$SRC" ]; then
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d -print -quit)"
fi
if [ -z "$SRC" ]; then
  echo "✗ 解压后没找到目录。"
  read -r -p "按回车键关闭..." _
  exit 3
fi
echo "✔ 解压完成： $(basename "$SRC")"
echo

# 3.1 备份
BACKUP="$(dirname "$ROOT")/${REPO_NAME}-backup-${STAMP}"
echo "正在备份到： $BACKUP"
cp -R "$ROOT" "$BACKUP"
echo "✔ 备份完成（出问题可以从这里还原）"
echo

# 3.2 覆盖（排除 samples 与 .git）
echo "正在覆盖文件 ..."
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude 'samples' --exclude '.git' "$SRC/" "$ROOT/"
else
  # 没有 rsync 时退化为 cp，同样跳过 samples
  for item in "$SRC"/*; do
    base="$(basename "$item")"
    [ "$base" = "samples" ] && continue
    cp -R "$item" "$ROOT/"
  done
fi
echo "✔ 文件覆盖完成"
echo

# 3.3 把仓库地址写回去
if grep -q 'data-repo="[^"]*"' index.html; then
  sed -i.bak 's|data-repo="[^"]*"|data-repo="'"$REPO"'"|' index.html && rm -f index.html.bak
  echo "✔ 已保留你的仓库地址配置"
fi

# 3.4 报一下新版本号
if [ -f "version.json" ]; then
  VER="$(grep -o '"version"[^,]*' version.json | head -1 | sed 's/.*: *"//' | sed 's/"//')"
  [ -n "${VER:-}" ] && echo "  当前版本： v$VER"
fi

echo
echo "------------------------------------------------------------"
echo "✔ 更新完成（下载覆盖方式）"
echo "------------------------------------------------------------"
echo "请刷新浏览器页面（Cmd+Shift+R）查看新版本。"
echo "备份位置： $BACKUP"
echo "确认一切正常后，可以手动删掉这个备份目录。"
echo
read -r -p "按回车键关闭..." _
exit 0
