@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Development-only Codex login helper. The packaged installer has its own
rem entrypoint; this file intentionally uses the checkout's local dependencies.
set "CASEFINDER_ROOT=%~dp0"
set "NODE_EXE=node.exe"
set "CODEX_EXE=%CASEFINDER_ROOT%node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"

where.exe "%NODE_EXE%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] A local Node.js installation was not found on PATH.
    echo Node.js ^>=24.14.0 and ^<25 is required.
    pause
    exit /b 1
)

for /f "tokens=1" %%V in ('"%NODE_EXE%" --version') do set "NODE_VERSION=%%V"
if not defined NODE_VERSION (
    echo [ERROR] Could not determine the local Node.js version.
    pause
    exit /b 1
)
powershell.exe -NoProfile -Command "$v = [version]'!NODE_VERSION:~1!'; if ($v -ge [version]'24.14.0' -and $v -lt [version]'25.0.0') { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo [ERROR] Node.js ^>=24.14.0 and ^<25 is required.
    echo Detected: !NODE_VERSION!
    pause
    exit /b 1
)

if not exist "%CODEX_EXE%" (
    echo [ERROR] The local Codex Windows x64 package was not found.
    echo Expected: %CODEX_EXE%
    echo Run npm ci in this checkout, then retry.
    pause
    exit /b 1
)

if not defined HOME set "HOME=%USERPROFILE%"
set "CODEX_HOME=%CASEFINDER_ROOT%state\codex-home"
"%NODE_EXE%" "%CASEFINDER_ROOT%scripts\prepare-codex-home.mjs"
if errorlevel 1 (
    echo [ERROR] The dedicated Case Finder Codex home could not be prepared.
    echo Global Codex authentication was not used.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Case Finder - Codex Account (dev)
echo ========================================
echo Node.js: !NODE_VERSION!
echo.

"%CODEX_EXE%" login status >nul 2>&1
if errorlevel 1 goto LOGIN

echo Codex is currently authenticated.
choice /C YN /N /M "Sign in with a different account? [Y/N]: "
if errorlevel 2 goto DONE

echo.
echo Signing out of the current Codex account...
"%CODEX_EXE%" logout
if errorlevel 1 (
    echo.
    echo [ERROR] Codex logout failed.
    pause
    exit /b 1
)

:LOGIN
echo.
echo Starting Codex sign-in...
"%CODEX_EXE%" login
if errorlevel 1 (
    echo.
    echo [ERROR] Codex sign-in failed or was cancelled.
    pause
    exit /b 1
)

echo.
echo Authentication status:
"%CODEX_EXE%" login status
if errorlevel 1 (
    echo.
    echo [ERROR] Codex authentication could not be verified.
    pause
    exit /b 1
)

:DONE
echo.
pause
exit /b 0
