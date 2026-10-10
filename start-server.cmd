@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================================
echo   同盟对战 · 阵容克制关系图  ——  本地预览服务（备选方式）
echo ==========================================================
echo.
echo  温馨提示：平时直接双击 index.html 就能用，不需要本脚本。
echo  只有在浏览器限制 file:// 页面本地存储时才需要它
echo  （例如某些版本的 Safari）。
echo.

where node >nul 2>nul
if %errorlevel%==0 (
    echo [启动] 检测到 Node.js，正在开启本地服务...
    echo         地址：http://127.0.0.1:8123/
    start "" http://127.0.0.1:8123/
    node "tools\serve.mjs" 8123
    goto end
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo [启动] 检测到 Python，正在开启本地服务...
    echo         地址：http://127.0.0.1:8123/
    start "" http://127.0.0.1:8123/
    python -m http.server 8123 --bind 127.0.0.1
    goto end
)

py -3 --version >nul 2>nul
if %errorlevel%==0 (
    echo [启动] 检测到 Python Launcher，正在开启本地服务...
    echo         地址：http://127.0.0.1:8123/
    start "" http://127.0.0.1:8123/
    py -3 -m http.server 8123 --bind 127.0.0.1
    goto end
)

echo [说明] 本机没有找到 Node.js 或 Python，这完全不影响使用：
echo.
echo        请直接双击本文件夹中的 index.html，
echo        用 Chrome / Edge / Firefox 打开即可使用全部功能，
echo        无需安装任何软件。
echo.

:end
pause
