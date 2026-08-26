@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "CASE_FINDER_ROOT=%~dp0"
set "APP_ROOT=%~dp0"
set "NODE_EXE=node.exe"
set "MANAGED_RUNTIME=0"
if exist "%~dp0app\src\server.js" if exist "%~dp0runtime\node\node.exe" (
  set "MANAGED_RUNTIME=1"
  set "APP_ROOT=%~dp0app"
  set "NODE_EXE=%~dp0runtime\node\node.exe"
  set "CASE_FINDER_INSTALL_ROOT=%~dp0"
  set "CASE_FINDER_APP_ROOT=%~dp0app"
  set "CASE_FINDER_ENV_PATH=%~dp0.env"
)
cd /d "%APP_ROOT%"

if "%MANAGED_RUNTIME%"=="1" if not exist "%APP_ROOT%\node_modules\@openai\codex\package.json" (
  echo Codex SDK package is missing from the installed dependency tree.
  echo Reinstall the application dependencies in the app directory and retry.
  exit /b 1
)

set "APP_PORT=3300"
if exist "%~dp0.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do if "%%A"=="PORT" set "APP_PORT=%%B"
)

for /f "tokens=1" %%V in ('"!NODE_EXE!" --version') do set "NODE_VERSION=%%V"
powershell.exe -NoProfile -Command "$v = [version]'!NODE_VERSION:~1!'; if ($v -ge [version]'24.14.0' -and $v -lt [version]'25.0.0') { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Node.js ^>=24.14.0 and ^<25 is required.
  "!NODE_EXE!" --version
  pause
  exit /b 1
)

if "%MANAGED_RUNTIME%"=="0" if not exist "node_modules\.bin\korean-law-mcp.cmd" (
  echo Installing dependencies with npm ci.
  call npm ci
  if errorlevel 1 (
    echo npm ci failed.
    pause
    exit /b 1
  )
)

if "%MANAGED_RUNTIME%"=="0" if not exist "node_modules\@openai\codex\package.json" (
  echo Codex SDK package is missing after npm ci.
  exit /b 1
)

if not exist "%CASE_FINDER_ROOT%logs" mkdir "%CASE_FINDER_ROOT%logs"
set "SERVER_PID="

call :startServer

:menu
echo.
echo Case Finder - http://127.0.0.1:%APP_PORT%
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

:getPortProcessInfo
set "PORT_IMAGE="
for /f "tokens=1 delims=," %%I in ('tasklist /FI "PID eq !PORT_PID!" /FO CSV /NH 2^>nul') do if not defined PORT_IMAGE set "PORT_IMAGE=%%~I"
if not defined PORT_IMAGE set "PORT_IMAGE=unknown image"
exit /b 0

:startServer
call :findPortPid
if defined PORT_PID (
  call :checkCaseFinderHealth
  if errorlevel 1 (
    call :getPortProcessInfo
    echo Port %APP_PORT% is used by PID !PORT_PID! ^(!PORT_IMAGE!^).
    echo Case Finder /health did not respond. The process may be stale or hung.
    echo Refusing to terminate an unconfirmed process. Stop PID !PORT_PID! manually or change PORT.
    exit /b 1
  )
  echo Existing Case Finder process !PORT_PID! is using port %APP_PORT%.
  echo Stopping the existing Case Finder process...
  taskkill /PID !PORT_PID! /T /F >nul 2>&1
  if errorlevel 1 (
    echo Failed to stop process !PORT_PID!.
    exit /b 1
  )
  call :waitForPortFree
  if errorlevel 1 (
    echo Port %APP_PORT% is still in use after stopping the existing process.
    exit /b 1
  )
)

echo Starting server...
set "SERVER_PID="
start "" /b "!NODE_EXE!" "!APP_ROOT!\src\server.js"

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
echo Check logs/error.log.
exit /b 1

:checkCaseFinderHealth
powershell.exe -NoProfile -Command "$u = 'http://127.0.0.1:%APP_PORT%/health'; try { $r = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match '\"service\"\s*:\s*\"case-finder\"') { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%

:waitForPortFree
for /l %%S in (1,1,10) do (
  call :findPortPid
  if not defined PORT_PID exit /b 0
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
)
call :findPortPid
if defined PORT_PID exit /b 1
exit /b 0

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
