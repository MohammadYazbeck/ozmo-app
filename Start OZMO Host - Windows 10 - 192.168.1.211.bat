@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title OZMO Office Host - Windows 10 - 192.168.1.211

set "OZMO_OFFICE_IP=192.168.1.211"
set "OZMO_HTTPS_PROFILE=windows-192.168.1.211"

echo OZMO - Windows 10 host
echo ======================
echo This launcher is reserved for 192.168.1.211.
echo.

if /I not "%OS%"=="Windows_NT" (
  echo This launcher can only run on Windows.
  goto :failure
)

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo Windows PowerShell is required to keep the OZMO host running.
  goto :failure
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22.13.0 or newer, then open this file again.
  goto :failure
)

node "scripts\check-node-version.mjs"
if errorlevel 1 goto :failure

node "scripts\check-required-host-ip.mjs" "192.168.1.211"
if errorlevel 1 goto :failure

netstat -ano -p tcp | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  node "scripts\check-office-running.mjs"
  if errorlevel 1 (
    echo Port 3000 is being used by another application or another OZMO certificate profile.
    echo Stop the existing host, then open this launcher again.
    goto :failure
  )
  node "scripts\check-office-host.mjs"
  if errorlevel 1 goto :failure
  echo OZMO is already running at https://192.168.1.211:3000
  goto :success
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm is missing.
  echo Open Command Prompt once and run: npm install --global pnpm
  goto :failure
)

node "scripts\windows-dependencies.mjs" check >nul 2>&1
if errorlevel 1 (
  echo Preparing OZMO on this Windows laptop for the first time...
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto :failure
  node "scripts\windows-dependencies.mjs" stamp
  if errorlevel 1 goto :failure
)

node "scripts\check-office-host.mjs"
if errorlevel 3 goto :failure
if errorlevel 2 goto :create_certificate
goto :certificate_ready

:create_certificate
echo.
echo Creating the HTTPS certificate for 192.168.1.211...
echo Git for Windows is required the first time because it includes OpenSSL.
call pnpm https:setup
if errorlevel 1 goto :failure

node "scripts\check-office-host.mjs"
if errorlevel 1 goto :failure

:certificate_ready
echo.
node "scripts\check-prebuilt-dist.mjs"
if errorlevel 1 (
  echo The prebuilt OZMO application is incomplete. Repairing it once...
  call pnpm build
  if errorlevel 1 goto :failure
  node "scripts\check-prebuilt-dist.mjs"
  if errorlevel 1 goto :failure
)

echo.
echo Starting OZMO at https://192.168.1.211:3000
echo Phone setup: http://192.168.1.211:3001
echo If Windows Firewall asks, allow Node.js on Private networks only.
echo Sleep protection, automatic restart, and a permanent error log are enabled.
echo Normal daily startup does not rebuild the application.
echo Keep this window open. Press Control+C to stop the host.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "scripts\windows-office-supervisor.ps1" -OfficeIp "192.168.1.211" -HttpsProfile "windows-192.168.1.211"
if errorlevel 1 goto :failure

:success
echo.
echo Press any key to close this window.
pause >nul
exit /b 0

:failure
echo.
echo OZMO could not start. No reports, inventory, tasks, or sessions were changed.
echo Press any key to close this window.
pause >nul
exit /b 1
