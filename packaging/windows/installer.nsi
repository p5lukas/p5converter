; p5converter Setup – installiert Programm + ffmpeg (alles enthalten, nichts nachzuinstallieren)
Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "dev"
!endif
!ifndef SRC
  !define SRC "."
!endif

Name "p5converter"
OutFile "p5converter-setup.exe"
InstallDir "$PROGRAMFILES64\p5converter"
InstallDirRegKey HKLM "Software\p5converter" "Dir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\p5converter.exe"
!define MUI_FINISHPAGE_RUN_TEXT "p5converter jetzt starten"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

Section "Install"
  SetOutPath "$INSTDIR"
  File "${SRC}\p5converter.exe"
  File "${SRC}\ffmpeg.exe"
  File "${SRC}\ffprobe.exe"
  File "${SRC}\LICENSE-p5converter.txt"
  File "${SRC}\ffmpeg-info.txt"
  CreateDirectory "$SMPROGRAMS\p5converter"
  CreateShortcut "$SMPROGRAMS\p5converter\p5converter.lnk" "$INSTDIR\p5converter.exe"
  CreateShortcut "$SMPROGRAMS\p5converter\Deinstallieren.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\p5converter.lnk" "$INSTDIR\p5converter.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\p5converter" "Dir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\p5converter" "DisplayName" "p5converter"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\p5converter" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\p5converter" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\p5converter" "Publisher" "p5lukas"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\p5converter.exe"
  Delete "$INSTDIR\ffmpeg.exe"
  Delete "$INSTDIR\ffprobe.exe"
  Delete "$INSTDIR\LICENSE-p5converter.txt"
  Delete "$INSTDIR\ffmpeg-info.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\p5converter\*.lnk"
  RMDir "$SMPROGRAMS\p5converter"
  Delete "$DESKTOP\p5converter.lnk"
  DeleteRegKey HKLM "Software\p5converter"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\p5converter"
SectionEnd
