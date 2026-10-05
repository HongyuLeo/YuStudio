@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请安装 Node.js 22 LTS / Please install Node.js 22 LTS: https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\@remotion\renderer\package.json" call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
set NODE_ENV=production
set NOCTURNE_OPEN_BROWSER=1
node dist-server/index.mjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo 启动失败，请查看以上错误。 / Startup failed. Please see the error above.
pause
exit /b 1
