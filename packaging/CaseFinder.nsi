Unicode true

!ifndef STAGING_ROOT
  !error "STAGING_ROOT is required"
!endif
!ifndef OUTFILE_PATH
  !define OUTFILE_PATH "CaseFinderSetup.exe"
!endif

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "..\assets\case-finder.ico"
!define MUI_UNICON "..\assets\case-finder.ico"
!define MUI_WELCOMEPAGE_TITLE "Case Finder Setup"
!define MUI_WELCOMEPAGE_TEXT "Install Case Finder for the current user."
!define MUI_FINISHPAGE_TITLE "Case Finder Setup Complete"
!define MUI_FINISHPAGE_TEXT "Launch Case Finder from the desktop or Start Menu."

Name "Case Finder"
Caption "Case Finder Setup"
BrandingText "Case Finder"
OutFile "${OUTFILE_PATH}"
InstallDir "$LOCALAPPDATA\CaseFinder"
InstallDirRegKey HKCU "Software\Case Finder" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "..\assets\case-finder.ico"
UninstallIcon "..\assets\case-finder.ico"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "0.1.0.0"
VIAddVersionKey /LANG=1042 "ProductName" "Case Finder"
VIAddVersionKey /LANG=1042 "FileDescription" "Case Finder Windows installer"
VIAddVersionKey /LANG=1042 "CompanyName" "Case Finder"
VIAddVersionKey /LANG=1042 "LegalCopyright" "Case Finder"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

Function StopCaseFinder
  ; Stop only the managed Node process whose command line contains the installed server path.
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$server = [IO.Path]::GetFullPath((Join-Path $$env:LOCALAPPDATA CaseFinder\app\src\server.js)); $$node = [IO.Path]::GetFullPath((Join-Path $$env:LOCALAPPDATA CaseFinder\runtime\node\node.exe)); Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq $$node -and $$_.CommandLine -and $$_.CommandLine -match [regex]::Escape($$server) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
FunctionEnd

Function un.StopCaseFinder
  ; Stop only the managed Node process whose command line contains the installed server path.
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$server = [IO.Path]::GetFullPath((Join-Path $$env:LOCALAPPDATA CaseFinder\app\src\server.js)); $$node = [IO.Path]::GetFullPath((Join-Path $$env:LOCALAPPDATA CaseFinder\runtime\node\node.exe)); Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq $$node -and $$_.CommandLine -and $$_.CommandLine -match [regex]::Escape($$server) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
FunctionEnd

Section "Case Finder" SecCaseFinder
  Call StopCaseFinder

  ; Replace immutable payload only. Mutable .env, state, and logs remain intact.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\assets"
  Delete "$INSTDIR\start.bat"
  Delete "$INSTDIR\.env.example"

  SetOutPath "$INSTDIR\app\src"
  File /r "${STAGING_ROOT}\app\src\*"
  SetOutPath "$INSTDIR\app\public"
  File /r "${STAGING_ROOT}\app\public\*"
  SetOutPath "$INSTDIR\app\prompts"
  File /r "${STAGING_ROOT}\app\prompts\*"
  SetOutPath "$INSTDIR\app\node_modules"
  File /r "${STAGING_ROOT}\app\node_modules\*"
  SetOutPath "$INSTDIR\app"
  File "${STAGING_ROOT}\app\config.js"
  File "${STAGING_ROOT}\app\package.json"
  File "${STAGING_ROOT}\app\package-lock.json"

  SetOutPath "$INSTDIR\runtime\node"
  File "${STAGING_ROOT}\runtime\node\node.exe"
  SetOutPath "$INSTDIR\assets"
  File "${STAGING_ROOT}\assets\case-finder.ico"
  SetOutPath "$INSTDIR"
  File "${STAGING_ROOT}\.env.example"
  File "${STAGING_ROOT}\start.bat"

  CreateDirectory "$INSTDIR\state"
  CreateDirectory "$INSTDIR\logs"
  IfFileExists "$INSTDIR\.env" env_ready
    CopyFiles "$INSTDIR\.env.example" "$INSTDIR\.env"
  env_ready:

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Case Finder" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "DisplayName" "Case Finder"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "Publisher" "Case Finder"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "DisplayIcon" "$INSTDIR\assets\case-finder.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder" "NoRepair" 1

  Delete "$DESKTOP\Case Finder.lnk"
  Delete "$SMPROGRAMS\Case Finder\Case Finder.lnk"
  Delete "$SMPROGRAMS\Case Finder\Case Finder 제거.lnk"
  CreateDirectory "$SMPROGRAMS\Case Finder"
  ; SetOutPath supplies the install root as the shortcut working directory.
  SetOutPath "$INSTDIR"
  CreateShortCut "$DESKTOP\Case Finder.lnk" "$INSTDIR\start.bat" "" "$INSTDIR\assets\case-finder.ico" 0 SW_SHOWNORMAL "" "Case Finder"
  CreateShortCut "$SMPROGRAMS\Case Finder\Case Finder.lnk" "$INSTDIR\start.bat" "" "$INSTDIR\assets\case-finder.ico" 0 SW_SHOWNORMAL "" "Case Finder"
  CreateShortCut "$SMPROGRAMS\Case Finder\Case Finder 제거.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\assets\case-finder.ico" 0 SW_SHOWNORMAL "" "Case Finder 제거"
SectionEnd

Section "Uninstall"
  Call un.StopCaseFinder
  Delete "$DESKTOP\Case Finder.lnk"
  Delete "$SMPROGRAMS\Case Finder\Case Finder.lnk"
  Delete "$SMPROGRAMS\Case Finder\Case Finder 제거.lnk"
  RMDir "$SMPROGRAMS\Case Finder"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Case Finder"
  DeleteRegKey HKCU "Software\Case Finder"

  ; Keep user-managed .env, state, and logs by deleting immutable payload only.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\assets"
  Delete "$INSTDIR\start.bat"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
