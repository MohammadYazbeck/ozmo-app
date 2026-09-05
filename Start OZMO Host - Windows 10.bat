@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title OZMO Office Host

echo OZMO - Windows 10 host
echo ======================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 22.13.0 or newer, then open this file again.
  goto :failure
)

node "scripts\check-node-version.mjs"
if errorlevel 1 goto :failure

netstat -ano -p tcp | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  node "scripts\check-office-running.mjs"
  if not errorlevel 1 (
    echo OZMO is already running on this laptop.
    node "scripts\check-office-host.mjs"
    goto :success
  )
  echo Port 3000 is being used by another application, so OZMO was not started.
  echo Close that application or change its port, then try again.
  goto :failure
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm is missing.
  echo Open Command Prompt once and run: npm install --global pnpm
  goto :failure
)

if not exist "node_modules\.bin\wrangler.cmd" (
  echo Preparing OZMO on this Windows laptop for the first time...
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto :failure
)

node "scripts\check-office-host.mjs"
set "CERTIFICATE_STATUS=!ERRORLEVEL!"
if "!CERTIFICATE_STATUS!"=="2" (
  echo.
  echo Creating the private HTTPS certificate for this Windows laptop...
  echo Git for Windows is required the first time because it includes OpenSSL.
  call pnpm https:setup
  if errorlevel 1 goto :failure
) else if not "!CERTIFICATE_STATUS!"=="0" (
  goto :failure
)

echo.
echo Preparing the latest OZMO version...
call pnpm build
if errorlevel 1 goto :failure

echo.
echo Starting OZMO for the private office network...
echo If Windows Firewall asks, allow Node.js on Private networks only.
echo Keep this window open. Press Control+C to stop the host.
echo.

call pnpm office:https
set "OZMO_RESULT=!ERRORLEVEL!"
echo.
echo OZMO has stopped.
if not "!OZMO_RESULT!"=="0" goto :failure

:success
echo.
echo Press any key to close this window.
pause >nul
exit /b 0

:failure
echo.
echo OZMO could not start. Keep this message visible if you need help.
echo Press any key to close this window.
pause >nul
exit /b 1
