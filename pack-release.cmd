@echo off
chcp 65001 >nul
title 同盟对战 - 打包发布
cd /d "%~dp0"

echo.
echo ============================================================
echo   同盟对战 · 阵容克制关系图   打包发布
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pack-release.ps1"
set RC=%errorlevel%

echo.
echo 按任意键关闭窗口...
pause >nul
exit /b %RC%
