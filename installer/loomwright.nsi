; Loomwright 2.0 — per-user Windows installer (NSIS 3.11)
; Build: makensis /DVERSION=3.0.0 loomwright.nsi

Unicode True
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "3.0.0"
!endif

!define APPNAME "Loomwright"
!define COMPANY "Loomwright"
!define EXENAME "loomwright.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Loomwright"

Name "${APPNAME} ${VERSION}"
OutFile "Loomwright-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Loomwright"
InstallDirRegKey HKCU "Software\Loomwright" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileDescription" "${APPNAME} setup"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "LegalCopyright" "© 2026 ${COMPANY}"

!define MUI_ICON "app.ico"
!define MUI_UNICON "app.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Start Loomwright now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

!insertmacro GetSize

Section "Loomwright (required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File "..\loomwright-window\target\release\${EXENAME}"
  File "app.ico"
  File "README.txt"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Loomwright"
  CreateShortcut "$SMPROGRAMS\Loomwright\Loomwright.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\Loomwright\Uninstall Loomwright.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Loomwright" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Loomwright" "Version" "${VERSION}"

  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\Loomwright.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\app.ico" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The Loomwright application and its documentation."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Add a shortcut to the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function .onInit
  ; Silent installers (deployment, /S) must never block on a dialog.
  IfSilent done
  ; Offer to upgrade in place when a previous copy exists.
  ReadRegStr $0 HKCU "Software\Loomwright" "InstallDir"
  StrCmp $0 "" done
  MessageBox MB_YESNO|MB_ICONQUESTION "Loomwright is already installed in:$\r$\n$0$\r$\n$\r$\nUpgrade in place? Your manuscripts are kept either way." IDYES done
  Abort
  done:
FunctionEnd

Section "Uninstall"
  Delete "$INSTDIR\${EXENAME}"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\Loomwright\Loomwright.lnk"
  Delete "$SMPROGRAMS\Loomwright\Uninstall Loomwright.lnk"
  RMDir "$SMPROGRAMS\Loomwright"
  Delete "$DESKTOP\Loomwright.lnk"

  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\Loomwright"
SectionEnd
