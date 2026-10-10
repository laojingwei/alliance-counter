@echo off
chcp 65001 >nul
title 同盟对战 - 用本地 zip 更新
cd /d "%~dp0"

echo.
echo ============================================================
echo   同盟对战 · 阵容克制关系图   用本地 zip 更新
echo ============================================================
echo.

REM 支持把 zip 直接拖到本脚本上（%1 就是那个 zip 的路径）
if not "%~1"=="" (
  echo 使用指定的更新包： %~1
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-from-zip.ps1" "%~1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-from-zip.ps1"
)
set RC=%errorlevel%

echo.
echo 按任意键关闭窗口...
pause >nul
exit /b %RC%
