@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "APP_PORT=3300"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do if "%%A"=="PORT" set "APP_PORT=%%B"
)

node --version | findstr /r /c:"v24\.14\.0" >nul
if errorlevel 1 (
  echo Node.js v24.14.0 is required.
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\.bin\korean-law-mcp.cmd" (
  echo Installing dependencies with npm ci.
  call npm ci
  if errorlevel 1 (
    echo npm ci failed.
    pause
    exit /b 1
  )
)

if not exist "logs" mkdir "logs"
set "SERVER_PID="

call :startServer

:menu
echo.
echo Fable Case Finder - http://127.0.0.1:%APP_PORT%
echo [S] Start server   [R] Restart server   [X] Stop server   [Q] Quit
choice /c SRXQ /n /m "Select: "
if errorlevel 4 goto quit
if errorlevel 3 (
  call :stopServer
  goto menu
)
if errorlevel 2 (
  call :stopServer
  call :startServer
  goto menu
)
if errorlevel 1 (
  call :startServer
  goto menu
)
goto menu

:findPortPid
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%APP_PORT% .*LISTENING"') do set "PORT_PID=%%P"
exit /b 0

:startServer
call :findPortPid
if defined PORT_PID (
  echo Port %APP_PORT% is already in use by process %PORT_PID%.
  echo The launcher did not start another server.
  exit /b 1
)

echo Starting server...
set "SERVER_PID="
start "" /b node.exe src/server.js

for /l %%S in (1,1,60) do (
  call :findPortPid
  if defined PORT_PID (
    set "SERVER_PID=!PORT_PID!"
    echo Server started. PID !SERVER_PID!, port %APP_PORT%.
    start "" "http://127.0.0.1:%APP_PORT%"
    exit /b 0
  )
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
)
echo Server did not open port %APP_PORT% within 60 seconds.
echo Check logs/server-error.log.
exit /b 1

:stopServer
if not defined SERVER_PID (
  call :findPortPid
  if defined PORT_PID echo No server started by this launcher. Port owner: %PORT_PID%.
  if not defined PORT_PID echo Server is not running.
  exit /b 1
)

echo Stopping server PID %SERVER_PID%...
taskkill /PID %SERVER_PID% /T /F >nul 2>&1
set "SERVER_PID="
for /l %%S in (1,1,10) do (
  call :findPortPid
  if not defined PORT_PID exit /b 0
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
)
echo Port %APP_PORT% is still in use. Check the process manually.
exit /b 1

:quit
if defined SERVER_PID call :stopServer
echo Launcher closed.
exit /b 0
