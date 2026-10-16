# GUI-Test unter echtem Windows: startet p5converter.exe MIT Fenster und prüft über die WebView2-Debug-Schnittstelle,
# dass die Oberfläche wirklich geladen wurde; prüft dann „Schließen versteckt nur das Fenster“ und „zweiter Start holt es zurück“.
# Aufruf: pwsh windows/gui-test.ps1 <Ordner mit p5converter.exe und ffmpeg.exe> <Ausgabeordner für gui.png/gui.json>
param([string]$Bin, [string]$Out)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowW(string c, string t);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$cfg = Join-Path $env:RUNNER_TEMP 'guicfg'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'
$exe = Join-Path $Bin 'p5converter.exe'
$args1 = @('--listen', '127.0.0.1:8790', '--config', $cfg, '--ffmpeg-dir', $Bin)
$p = Start-Process -FilePath $exe -ArgumentList $args1 -PassThru
$res = [ordered]@{}
try {
  # 1) Fenster erscheint
  $h = [IntPtr]::Zero
  for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep 1; $h = [W32]::FindWindowW($null, 'p5converter') }
  $res.fensterGefunden = ($h -ne [IntPtr]::Zero)
  if (-not $res.fensterGefunden) { throw 'Kein Fenster "p5converter" gefunden (WebView2 fehlt oder kein Desktop?)' }
  $res.fensterSichtbar = [W32]::IsWindowVisible($h)
  $r = New-Object W32+RECT; [W32]::GetWindowRect($h, [ref]$r) | Out-Null
  $res.fensterGroesse = "$($r.R - $r.L)x$($r.B - $r.T)"
  # 2) Oberfläche ist geladen (Chrome-DevTools-Protokoll über Node)
  $ws = Join-Path $env:RUNNER_TEMP 'wsmod'; New-Item -ItemType Directory -Force $ws | Out-Null
  Push-Location $ws; npm install ws --no-save --silent 2>&1 | Out-Null; Pop-Location
  $env:NODE_PATH = Join-Path $ws 'node_modules'
  $env:GUI_OUT = $Out
  node (Join-Path $PSScriptRoot 'gui-check.js')
  if ($LASTEXITCODE -ne 0) { throw 'Oberflächen-Prüfung fehlgeschlagen (siehe Ausgabe)' }
  # 3) Schließen versteckt nur
  [W32]::PostMessageW($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  Start-Sleep 2
  $p.Refresh()
  $res.laeuftNachSchliessen = -not $p.HasExited
  $res.sichtbarNachSchliessen = [W32]::IsWindowVisible($h)
  if ($p.HasExited) { throw 'Programm endete beim Schließen (sollte im Infobereich weiterlaufen)' }
  if ($res.sichtbarNachSchliessen) { throw 'Fenster blieb nach dem Schließen sichtbar' }
  # 4) zweiter Start holt das Fenster zurück
  Start-Process -FilePath $exe -ArgumentList $args1 -Wait
  Start-Sleep 1
  $res.sichtbarNachZweitemStart = [W32]::IsWindowVisible($h)
  if (-not $res.sichtbarNachZweitemStart) { throw 'Zweiter Start holte das Fenster nicht zurück' }
  $res.ergebnis = 'ok'
} finally {
  $res | ConvertTo-Json | Tee-Object -FilePath (Join-Path $Out 'gui-ergebnis.json')
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
