@echo off
chcp 65001 >nul
title 同盟对战 - 自动更新
cd /d "%~dp0"

echo.
echo ============================================================
echo   同盟对战 · 阵容克制关系图   自动更新
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update-windows.ps1"
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo 按任意键关闭窗口...
) else (
  echo 更新没有完成，退出码 %RC%
  echo 按任意键关闭窗口...
)
pause >nul
exit /b %RC%
