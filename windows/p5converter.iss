; Inno Setup – EINE Datei p5converter-setup.exe mit allem (Programm, ffmpeg, WebView2-Starter).
; Gebaut in der CI (.github/workflows/build.yml, Job "windows"); Aufruf: iscc /DAppVersion=0.1.0 /DSourceDir=<Ordner mit den Dateien> windows\p5converter.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\build"
#endif

[Setup]
AppId={{6E1C2B7A-5C0F-4B7E-9A55-0D5B1C0A5C01}
AppName=p5converter
AppVersion={#AppVersion}
AppVerName=p5converter {#AppVersion}
AppPublisher=p5lukas
AppPublisherURL=https://github.com/p5lukas/p5converter
AppSupportURL=https://github.com/p5lukas/p5converter/issues
; nur für den Benutzer, keine Administrator-Abfrage
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\p5converter
DefaultGroupName=p5converter
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir={#SourceDir}\out
OutputBaseFilename=p5converter-setup
SetupIconFile=p5converter.ico
UninstallDisplayIcon={app}\p5converter.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; ein laufendes p5converter wird beim Aktualisieren erkannt (Programm-Mutex) und geschlossen
AppMutex=p5converter-single-instance
CloseApplications=yes
RestartApplications=no
UsePreviousTasks=yes

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Symbol auf dem Desktop anlegen"; GroupDescription: "Zusätzliche Symbole:"
Name: "autostart"; Description: "p5converter beim Anmelden an Windows starten"; GroupDescription: "Autostart:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\p5converter.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\ffmpeg.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\ffprobe.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\ffmpeg-LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{group}\p5converter"; Filename: "{app}\p5converter.exe"
Name: "{group}\p5converter deinstallieren"; Filename: "{uninstallexe}"
Name: "{autodesktop}\p5converter"; Filename: "{app}\p5converter.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "p5converter"; ValueData: """{app}\p5converter.exe"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
; WebView2-Laufzeit nur installieren, wenn sie fehlt (Windows 11 und aktuelles Windows 10 haben sie schon)
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Microsoft WebView2 (Fenster-Komponente) wird eingerichtet …"; Flags: waituntilterminated; Check: NeedsWebView2
Filename: "{app}\p5converter.exe"; Description: "p5converter jetzt starten"; Flags: nowait postinstall skipifsilent

[Code]
const WebView2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Version(): String;
var v: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebView2Guid, 'pv', v) then Result := v
  else if RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2Guid, 'pv', v) then Result := v;
end;

function NeedsWebView2(): Boolean;
var v: String;
begin
  v := WebView2Version();
  Result := (v = '') or (v = '0.0.0.0');
end;
