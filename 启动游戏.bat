@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   未找到 Node.js。请先安装 Node.js 18 或更高版本。
  echo   https://nodejs.org/
  echo.
  pause
  exit /b 1
)
echo.
echo   正在启动「竹知了 · 3D 夏日蝉鸣」...
echo   浏览器将打开 http://127.0.0.1:4173/
echo.
start "竹知了服务" /min cmd /c "node server.mjs"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4173/"
echo   游戏服务已在后台启动。关闭「竹知了服务」窗口即可停止。
timeout /t 4 /nobreak >nul
