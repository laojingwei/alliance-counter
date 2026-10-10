@echo off
chcp 65001 >nul
title 同盟对战 - 推送到 GitHub
cd /d "%~dp0"

echo.
echo ============================================================
echo   把本项目推送到 GitHub
echo ============================================================
echo.

set "REPO_URL=https://github.com/laojingwei/alliance-counter.git"

echo 目标仓库： %REPO_URL%
echo.

REM ---- 先测一下能不能连上 GitHub ----
echo 正在检查与 GitHub 的连接 ...
git ls-remote %REPO_URL% >nul 2>&1
if errorlevel 1 (
  echo.
  echo ✗ 连不上 GitHub（命令行环境）。
  echo.
  echo   如果是「schannel: SEC_E_NO_CREDENTIALS」或一直卡住，
  echo   通常是 DNS 被污染或需要代理。可以试试：
  echo     1) 打开你的代理软件，让它开启「系统代理」或「TUN 模式」，再重跑本脚本；
  echo     2) 或者给 git 单独配代理（把端口换成你自己的）：
  echo          git config --global http.proxy  http://127.0.0.1:7890
  echo          git config --global https.proxy http://127.0.0.1:7890
  echo     3) 或者用 GitHub Desktop 图形客户端打开本目录后点 Push。
  echo.
  pause
  exit /b 1
)

echo ✔ 连接正常
echo.

REM ---- 设置 remote ----
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
echo ✔ 已设置 remote origin

echo.
echo 正在推送 ...
git push -u origin main
if errorlevel 1 (
  echo.
  echo ✗ 推送失败。可能原因：
  echo   · 远程仓库还没创建 —— 先到 https://github.com/new 建一个名为 alliance-counter 的仓库
  echo     （不要勾选 README / .gitignore / License，保持空仓库）；
  echo   · 没有推送权限 —— 确认登录的是 laojingwei 这个账号；
  echo   · 网络中断 —— 重试一次。
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   ✔ 推送完成
echo ============================================================
echo   仓库地址： https://github.com/laojingwei/alliance-counter
echo.
pause
