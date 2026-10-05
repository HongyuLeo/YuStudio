@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm run dist:win
if errorlevel 1 goto failed
echo Windows 桌面包在 release 文件夹中。 / Windows package is in release.
start "" "%~dp0release"
pause
exit /b 0
:failed
echo 构建失败，请查看以上错误。 / Build failed. Please see the error above.
pause
exit /b 1
