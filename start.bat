@echo off
rem The installer or shortcut should use assets\case-finder.ico as the launcher icon.
setlocal EnableExtensions DisableDelayedExpansion

set "CASE_FINDER_ROOT=%~dp0"
set "APP_ROOT=%~dp0"
set "NODE_EXE=node.exe"
set "MANAGED_RUNTIME=0"

if not exist "%~dp0app\src\server.js" goto runtime_selected
if not exist "%~dp0runtime\node\node.exe" goto runtime_selected
set "MANAGED_RUNTIME=1"
set "APP_ROOT=%~dp0app"
set "NODE_EXE=%~dp0runtime\node\node.exe"
set "CASE_FINDER_INSTALL_ROOT=%~dp0"
set "CASE_FINDER_APP_ROOT=%~dp0app"
set "CASE_FINDER_ENV_PATH=%~dp0.env"

:runtime_selected
cd /d "%APP_ROOT%"
if not errorlevel 1 goto runtime_directory_ready
echo Could not enter the Case Finder application directory.
exit /b 1

:runtime_directory_ready
set "APP_PORT=3300"
if not exist "%~dp0.env" goto port_ready
for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do if /i "%%A"=="PORT" set "APP_PORT=%%~B"

:port_ready
powershell.exe -NoProfile -Command "$v = $env:APP_PORT; if ($v -notmatch '^\d+$' -or [int]$v -lt 1 -or [int]$v -gt 65535) { exit 1 } else { exit 0 }"
if not errorlevel 1 goto port_valid
echo PORT must contain only digits and be between 1 and 65535.
pause
exit /b 1

:port_valid
set "NODE_VERSION="
for /f "tokens=1" %%V in ('"%NODE_EXE%" --version') do set "NODE_VERSION=%%V"
if defined NODE_VERSION goto node_version_detected
echo Could not determine the Node.js version.
pause
exit /b 1

:node_version_detected
powershell.exe -NoProfile -Command "$v = [version]'%NODE_VERSION:~1%'; if ($v -ge [version]'24.14.0' -and $v -lt [version]'25.0.0') { exit 0 } else { exit 1 }"
if not errorlevel 1 goto node_version_valid
echo Node.js ^>=24.14.0 and ^<25 is required.
"%NODE_EXE%" --version
pause
exit /b 1

:node_version_valid
:source_dependency_check
if not "%MANAGED_RUNTIME%"=="0" goto managed_dependency_check
if exist "%APP_ROOT%\node_modules\.bin\korean-law-mcp.cmd" goto source_codex_check
echo Installing dependencies with npm ci.
call npm ci
if not errorlevel 1 goto source_codex_check
echo npm ci failed.
pause
exit /b 1

:source_codex_check
if exist "%APP_ROOT%\node_modules\@openai\codex\package.json" goto dependencies_ready
echo Codex SDK package is missing after npm ci.
exit /b 1

:managed_dependency_check
if exist "%APP_ROOT%\node_modules\@openai\codex\package.json" goto dependencies_ready
echo Codex SDK package is missing from the installed dependency tree.
echo Reinstall the application dependencies in the app directory and retry.
exit /b 1

:dependencies_ready
if exist "%CASE_FINDER_ROOT%logs" goto logs_ready
mkdir "%CASE_FINDER_ROOT%logs"

:logs_ready
set "SERVER_PID="
call :startServer

:menu
echo.
echo Case Finder - http://127.0.0.1:%APP_PORT%
echo [S] Start server   [R] Restart server   [X] Stop server   [Q] Quit
choice /c SRXQ /n /m "Select: "
if errorlevel 4 goto quit
if errorlevel 3 goto menu_stop
if errorlevel 2 goto menu_restart
if errorlevel 1 goto menu_start
goto menu

:menu_stop
call :stopServer
goto menu

:menu_restart
call :stopServer
call :startServer
goto menu

:menu_start
call :startServer
goto menu

:findPortPid
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%APP_PORT% .*LISTENING"') do set "PORT_PID=%%P"
exit /b 0

:getPortProcessInfo
set "PORT_IMAGE="
for /f "tokens=1 delims=," %%I in ('tasklist /FI "PID eq %PORT_PID%" /FO CSV /NH 2^>nul') do if not defined PORT_IMAGE set "PORT_IMAGE=%%~I"
if defined PORT_IMAGE exit /b 0
set "PORT_IMAGE=unknown image"
exit /b 0

:checkExpectedServerProcess
set "EXPECTED_SERVER_PROCESS=0"
for /f "delims=" %%E in ('powershell.exe -NoProfile -Command "try { $p = Get-CimInstance Win32_Process -Filter 'ProcessId=%PORT_PID%' -ErrorAction Stop; $expected = [IO.Path]::GetFullPath((Join-Path $env:APP_ROOT 'src\server.js')); $pattern = '(?i)(?:^|\s|\x22)' + [regex]::Escape($expected) + '(?:$|\s|\x22)'; if ($p -and $p.CommandLine -and $p.CommandLine -match $pattern) { Write-Output OK } } catch { exit 1 }"') do if "%%E"=="OK" set "EXPECTED_SERVER_PROCESS=1"
if "%EXPECTED_SERVER_PROCESS%"=="1" exit /b 0
exit /b 1

:startServer
call :findPortPid
if not defined PORT_PID goto launchServer
call :checkCaseFinderHealth
call :getPortProcessInfo
call :checkExpectedServerProcess
if not errorlevel 1 goto stopExistingServer
echo Port %APP_PORT% is used by PID %PORT_PID% - %PORT_IMAGE%.
echo Refusing to terminate an unconfirmed process or non-Case Finder process.
echo Stop PID %PORT_PID% manually or change PORT.
exit /b 1

:stopExistingServer
echo Existing Case Finder process %PORT_PID% is using port %APP_PORT%.
echo Stopping the existing Case Finder process...
taskkill /PID %PORT_PID% /T /F >nul 2>&1
if not errorlevel 1 goto existingServerStopped
echo Failed to stop process %PORT_PID%.
exit /b 1

:existingServerStopped
call :waitForPortFree
if not errorlevel 1 goto launchServer
echo Port %APP_PORT% is still in use after stopping the existing process.
exit /b 1

:launchServer
echo Starting server...
set "SERVER_PID="
set "SERVER_START_ATTEMPT=0"
start "" /b "%NODE_EXE%" "%APP_ROOT%\src\server.js"
if not errorlevel 1 goto waitForServer
echo Could not start the Case Finder server.
exit /b 1

:waitForServer
set /a SERVER_START_ATTEMPT+=1 >nul
call :findPortPid
if defined PORT_PID goto serverStarted
if %SERVER_START_ATTEMPT% GEQ 60 goto serverStartFailed
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
goto waitForServer

:serverStarted
set "SERVER_PID=%PORT_PID%"
echo Server started. PID %SERVER_PID%, port %APP_PORT%.
start "" "http://127.0.0.1:%APP_PORT%"
exit /b 0

:serverStartFailed
echo Server did not open port %APP_PORT% within 60 seconds.
echo Check logs/error.log.
exit /b 1

:checkCaseFinderHealth
powershell.exe -NoProfile -Command "$u = 'http://127.0.0.1:%APP_PORT%/health'; try { $r = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match '\"service\"\s*:\s*\"case-finder\"') { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %errorlevel%

:waitForPortFree
set /a PORT_FREE_ATTEMPT=0 >nul

:waitForPortFreeLoop
call :findPortPid
if not defined PORT_PID exit /b 0
set /a PORT_FREE_ATTEMPT+=1 >nul
if %PORT_FREE_ATTEMPT% GEQ 10 exit /b 1
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
goto waitForPortFreeLoop

:stopServer
if defined SERVER_PID goto stopTrackedServer
call :findPortPid
if not defined PORT_PID goto noServerToStop
echo No server started by this launcher. Port owner: PID %PORT_PID%.
exit /b 1

:noServerToStop
echo Server is not running.
exit /b 1

:stopTrackedServer
call :findPortPid
if not defined PORT_PID goto trackedServerGone
if "%PORT_PID%"=="%SERVER_PID%" goto killTrackedServer
echo Tracked server PID %SERVER_PID% no longer owns port %APP_PORT%.
echo Current port owner is PID %PORT_PID%. Refusing to terminate it.
exit /b 1

:trackedServerGone
echo Server PID %SERVER_PID% is no longer listening.
set "SERVER_PID="
exit /b 0

:killTrackedServer
echo Stopping server PID %SERVER_PID%...
taskkill /PID %SERVER_PID% /T /F >nul 2>&1
if not errorlevel 1 goto trackedServerStopped
echo Failed to stop server PID %SERVER_PID%.
exit /b 1

:trackedServerStopped
set "SERVER_PID="
call :waitForPortFree
if not errorlevel 1 exit /b 0
echo Port %APP_PORT% is still in use. Check the process manually.
exit /b 1

:quit
if not defined SERVER_PID goto launcher_closed
call :stopServer

:launcher_closed
echo Launcher closed.
exit /b 0
