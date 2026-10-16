# GUI-Test unter echtem Windows: startet p5converter.exe MIT Fenster und prüft, dass (1) das Fenster erscheint, (2) die Oberfläche darin wirklich
# geladen wurde (das Programm-Protokoll meldet „Oberfläche verbunden“ mit der Kennung des WebView2-Fensters), (3) Schließen das Fenster nur versteckt
# und das Programm weiterläuft, (4) ein zweiter Start das Fenster zurückholt. Dazu ein Bild des Bildschirms (gui.png).
# Aufruf: pwsh windows/gui-test.ps1 <Ordner mit p5converter.exe und ffmpeg.exe> <Ausgabeordner>
param([string]$Bin, [string]$Out)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$cfg = Join-Path $env:RUNNER_TEMP 'guicfg'
$exe = Join-Path $Bin 'p5converter.exe'
$args1 = @('--listen', '127.0.0.1:8790', '--config', $cfg, '--ffmpeg-dir', $Bin)
$env:P5_TEST_HW_DELAY = '4000'  # Hardware-Erkennung künstlich verzögern: die Oberfläche fragt, bevor sie fertig ist (der Fehler von 0.1.2)
$p = Start-Process -FilePath $exe -ArgumentList $args1 -PassThru
$res = [ordered]@{}
try {
  # 1) Fenster erscheint (über das Fenster-Handle des Prozesses)
  $h = [IntPtr]::Zero
  for ($i = 0; $i -lt 40 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep 1; $p.Refresh(); $h = $p.MainWindowHandle }
  $res.fensterGefunden = ($h -ne [IntPtr]::Zero)
  if (-not $res.fensterGefunden) { throw 'Kein Fenster gefunden (WebView2 fehlt oder kein Desktop?)' }
  $res.fensterTitel = $p.MainWindowTitle
  $res.fensterSichtbar = [W32]::IsWindowVisible($h)
  $r = New-Object W32+RECT; [W32]::GetWindowRect($h, [ref]$r) | Out-Null
  $res.fensterGroesse = "$($r.R - $r.L)x$($r.B - $r.T)"
  # 2) Oberfläche ist im Fenster geladen: das Protokoll nennt die Kennung des Fensters, sobald die Seite ihre erste Anfrage stellt
  $log = Join-Path $cfg 'logs\p5converter.log'
  $line = $null
  for ($i = 0; $i -lt 40 -and -not $line; $i++) {
    if (Test-Path $log) { $line = Get-Content $log | Where-Object { $_ -match 'Oberfläche verbunden' } | Select-Object -First 1 }
    if (-not $line) { Start-Sleep 1 }
  }
  $res.oberflaecheVerbunden = [string]$line
  # Hardware-Erkennung läuft fertig, und in der Oberfläche trat kein Fehler auf (Fehler meldet sie ins Protokoll)
  $hwDone = $null
  for ($i = 0; $i -lt 30 -and -not $hwDone; $i++) { $hwDone = Get-Content $log | Where-Object { $_ -match 'Hardware-Erkennung fertig' } | Select-Object -First 1; if (-not $hwDone) { Start-Sleep 1 } }
  Start-Sleep 3
  $res.hardwareErkennungFertig = [bool]$hwDone
  $uiErr = Get-Content $log | Where-Object { $_ -match 'Fehler in der Oberfläche' }
  $res.oberflaechenFehler = @($uiErr)
  $bmp = New-Object System.Drawing.Bitmap ([System.Windows.Forms.SystemInformation]::PrimaryMonitorSize.Width), ([System.Windows.Forms.SystemInformation]::PrimaryMonitorSize.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save((Join-Path $Out 'gui.png')); $g.Dispose(); $bmp.Dispose()
  if (-not $line) { throw 'Die Oberfläche hat sich im Fenster nicht gemeldet (Seite nicht geladen?)' }
  if (@($uiErr).Count -gt 0) { throw ('Fehler in der Oberfläche: ' + ($uiErr -join ' | ')) }
  if (-not $hwDone) { throw 'Die Hardware-Erkennung wurde nicht fertig' }
  if ($line -notmatch 'Edg/') { throw "Die Oberfläche kam nicht aus einem WebView2-Fenster: $line" }
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
  $vis = $false
  for ($i = 0; $i -lt 10 -and -not $vis; $i++) { Start-Sleep 1; $vis = [W32]::IsWindowVisible($h) }
  $res.sichtbarNachZweitemStart = $vis
  if (-not $vis) { throw 'Zweiter Start holte das Fenster nicht zurück' }
  $res.ergebnis = 'ok'
} finally {
  "--- Prozesse mit Fenster ---"; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { "{0} | {1}" -f $_.ProcessName, $_.MainWindowTitle }
  "--- Protokoll (Konfig) ---"; $cl = Join-Path $cfg 'logs\p5converter.log'; if (Test-Path $cl) { Get-Content $cl -Tail 25 | Where-Object { $_ -notmatch 'nicht nutzbar' } } else { "keine Datei $cl" }
  $res | ConvertTo-Json | Tee-Object -FilePath (Join-Path $Out 'gui-ergebnis.json')
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
