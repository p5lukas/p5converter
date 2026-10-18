<p align="center"><img src="web/icon-512.png" alt="p5converter" width="160"></p>

# p5converter

Audio- und Video-Konverter mit Web-Oberfläche für **Unraid / Docker** – ein SoundConverter-Klon mit zusätzlicher Video-Welt.
Ein einzelnes Go-Programm (nur Standardbibliothek) steuert **ffmpeg** an; das Docker-Image bringt alles mit (ffmpeg mit x264/x265/SVT-AV1, Intel-/AMD-Treiber für Quick Sync/VAAPI).

> **Status: v0.0.x Vorabversion** (aktuell 0.0.8, siehe `CHANGELOG.md`). Windows- und Linux-Desktop-App (mit eigener Oberfläche) folgen später.

## App-Icon
Gleicher Aufbau wie bei **p5assets** (Matrix-Regen, Poster-Rahmen, „p5“); das Abzeichen unten rechts unterscheidet die Apps: bei p5converter **silberne Audio-CD + blaue Blu-ray** (Audio und Video), bei p5assets ein oranger Komet. Dateien: `web/icon*.png`, `web/apple-touch-icon.png` (iPhone/iPad-Web-App), `unraid/icon.png`; Quelle und Erzeugung: `tools/icons/` (`make_icons.py converter <Ordner>`).

## Windows (Test auf `dev`)
**Eine Datei:** `p5converter-setup.exe` aus der Vorabversion [`dev-latest`](https://github.com/p5lukas/p5converter/releases/tag/dev-latest) laden und starten. Windows meldet beim ersten Start einmal „Unbekannter Herausgeber“ (die Datei ist nicht mit einem Zertifikat signiert): **Weitere Informationen → Trotzdem ausführen**. Danach durchklicken – fertig. Der Installer richtet sich nur für dein Konto ein (keine Administrator-Abfrage), enthält Programm und ffmpeg und legt ein Startmenü-Symbol an (Desktop-Symbol und Autostart optional).
* Die Oberfläche öffnet in einem **eigenen Fenster** (Microsoft Edge WebView2, in Windows 11 und aktuellem Windows 10 schon vorhanden; sonst richtet der Installer es ein) und sieht genauso aus wie im Browser.
* **Hardware wird automatisch erkannt:** Intel Quick Sync, NVIDIA NVENC und AMD AMF (jeweils mit aktuellem Grafiktreiber), sonst rechnet die CPU. Ist ein NVIDIA-Treiber zu alt für NVENC, steht unter Einstellungen → Hardware → „Warum?“ in Klartext, welche Version fehlt – dann den Treiber aktualisieren.
* Einstellungen und Logs liegen in `%APPDATA%\p5converter`.
* **Symbol im Infobereich (Tray):** Das Schließen-Kreuz versteckt nur das Fenster, p5converter und laufende Aufträge laufen weiter. Klick auf das Symbol (oder ein zweiter Start) zeigt das Fenster wieder; **Beenden** über das Symbol oder den Knopf „Beenden“ in der Oberfläche.
* Die Datei liegt immer in der laufenden Vorabversion `dev-latest` (nicht in `v0.1.0-dev`, das sind die Docker-Stände); bei einer neuen Versions-Vorabversion vom Branch `dev` hängt sie zusätzlich dort als Anhang.

## Kanäle: `:latest` und `:dev`
| Image | Branch | Wofür |
|---|---|---|
| `ghcr.io/p5lukas/p5converter:latest` | `main` | stabil |
| `ghcr.io/p5lukas/p5converter:dev` | `dev` | Neues zuerst testen (Unraid vorher mit der Vorlage `unraid/p5converter-dev.xml` oder im Container das Image auf `:dev` stellen) |
| `ghcr.io/p5lukas/p5converter:<Version>` | Tag | feste Version |

Neue Funktionen landen zuerst auf `dev`; nach dem Test geht es nach `main`. Der Build läuft per GitHub Action bei Push auf `dev` bzw. `main`.

## Installation (Unraid)

1. `unraid/p5converter.xml` nach `/boot/config/plugins/dockerMan/templates-user/` kopieren.
2. Unraid → **Docker → Container hinzufügen → p5converter** → Pfade prüfen → **Apply**.
3. Weboberfläche: `http://<unraid-ip>:8787`

Oder per Kommandozeile:
```bash
docker run -d --name p5converter -p 8787:8787 \
  --device /dev/dri \
  -v /mnt/user/musik:/audio1 -v /mnt/user/filme:/video1 \
  -v /mnt/user/appdata/p5converter/output:/output -v /mnt/user/appdata/p5converter/config:/config \
  ghcr.io/p5lukas/p5converter:latest
```
* `--device /dev/dri` reicht Intel Quick Sync / VAAPI durch (im Unraid-Template ein sichtbarer Eintrag „Intel/AMD Grafik“).
* `/config` speichert Einstellungen, Voreinstellungen, Farben und die Anmeldung dauerhaft (gilt auf allen Geräten). Ohne diesen Pfad funktioniert alles, wird aber nicht gespeichert; die Anmeldung lässt sich dann nicht einschalten.
* **GPU einrichten (alles optional, ohne GPU rechnet die CPU):**

  | Hardware | Was du tun musst |
  |---|---|
  | **Intel Quick Sync** | nichts – `--device /dev/dri` (im Unraid-Template schon eingetragen) |
  | **AMD** (unter Linux per VAAPI) | nichts – ebenfalls `--device /dev/dri`; AMD AMF gibt es nur unter Windows |
  | **NVIDIA NVENC** | Nvidia-Driver-Plugin (Unraid) bzw. NVIDIA Container Toolkit installieren und `--runtime=nvidia` bei „Extra Parameters“ ergänzen (Unraid: Erweiterte Ansicht). `NVIDIA_VISIBLE_DEVICES=all` und `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility` sind im Image voreingestellt |

  `--runtime=nvidia` ist bewusst **nicht** vorausgefüllt: Ohne NVIDIA-Treiber würde Docker den Container gar nicht starten. Ob die GPU erkannt wurde, steht unter Einstellungen → Hardware (dort auch ein Hinweis, falls eine GPU fehlt).
* Die Oberfläche sieht nur eingehängte Ordner: im Unraid-Template **2× Audio** (`/audio1`, `/audio2`), **4× Video** (`/video1` … `/video4`) – alle optional, leer lassen was nicht gebraucht wird – und den Zielordner `/output`. Per Kommandozeile geht auch ein einzelnes `/media`. Die Liste steht in `P5_ROOTS`; nicht eingehängte Ordner werden ausgeblendet. Die Quell-Ordner brauchen Schreibzugriff, wenn die Ergebnisse neben die Quelle sollen oder Quellen gelöscht werden. `PUID`/`PGID` (Standard 99/100) bestimmen den Besitzer neuer Dateien.
* Anmeldung (optional): wird in der Oberfläche unter **Einstellungen → Anmeldung** angelegt, nicht per Umgebungsvariable. Trotzdem nicht ins Internet stellen.

## Funktionen

### Design
Gleiche Designlinie wie [p5assets](https://github.com/p5lukas/p5assets): Matrix-Theme, Audio und Video als eigene **Welten** mit Farbe und Planet (Wurmloch-Flug beim Wechsel), Übersicht mit Fortschrittsring und Live-Auslastung, Version und Neuigkeiten in der Fußzeile (nach einem Update einmal pro Version ein kurzer Hinweis, der Merker liegt auf dem Server); in der iPhone/iPad-Web-App Ziehen zum Aktualisieren.
Läuft auf Desktop, Handy und iPad (Hoch-/Querformat); auf iPhone/iPad per **Teilen → Zum Home-Bildschirm** als Web-App.

### Hilfe für Einsteiger
Jede Einstellung hat einen kleinen **ⓘ**-Punkt mit einfacher Erklärung und Beispielen (z. B. wann 10 Bit sinnvoll ist).

### Audio (wie SoundConverter)
MP3, Ogg Vorbis, Opus, AAC/M4A, FLAC, WAV · VBR-Qualität oder konstante Bitrate · Samplerate/Kanäle · Tags und Cover bleiben erhalten · Ordner rekursiv hinzufügen ·
Zielordner mit Struktur oder Namensmuster (`{artist}/{album}/{track} - {title}`) · „Wenn Datei existiert“: beide behalten und die neue nummerieren (`Film (2).mkv`) / überspringen / überschreiben (mit Warnfarbe) · Quelle optional löschen – nur nach bestandener **Kontrolle der neuen Datei** (lesbar und gleich lang; optional Spuren/Größe, kompletter Decode-Test).

### Video
* Container **MKV** (Standard) oder MP4, „Nur Remux“ (Video kopieren)
* Codec **H.264, H.265, AV1, VP9**
* **Auflösung** (max. Höhe, nie hochskaliert), **CRF** (mit automatischem Vorschlag je nach Art des Materials: Anime, Korn, aktueller Film …), Geschwindigkeits-Preset, **8/10 Bit** (oder „wie Quelle“)
* **Audio & Untertitel in einem Schritt, auch für Einsteiger und für ganze Serien:** Standard ist **Passthrough** (nichts ändern). Das Programm macht Vorschläge, jeder lässt sich abwählen. **Drei Ansichten:** **Gruppen** (Dateien mit gleichen Sprachen zusammengefasst, Haken je Sprache gilt für die ganze Gruppe, Vorschau „Was passiert“, abweichende Dateien markiert), **Tabelle** (Dateien × Sprachen mit Haken) und **Einzelne Dateien** (Spurkarten in Klartext mit „Erweitert“: Titel, Sprache, **Forced (erzwungene Untertitel)**, Standard, Format). **Regeln nach Format** (z. B. nur DTS in AC-3 umwandeln, Bild-Untertitel entfernen; erste passende Regel gewinnt; als Voreinstellung speicherbar; mit Regel-Vorschlägen) und **Sprach-Wünsche** in den Einstellungen als Rangliste (Ton/Untertitel behalten, Standard-Ton, Standard-Untertitel z. B. „Deutsch Forced“). Die Wirkung steht vor dem Start in der Zusammenfassung
* **Plex:** Sprache wird als dreibuchstabiger Code geschrieben; „Forced“ erkennt Plex nur in **MKV** (bei MP4 kommt eine Warnung) und die Untertitelsprache muss zur Tonspur passen; danach in Plex neu **analysieren**
* Schriftarten-Anhänge bleiben in MKV erhalten

> **Unraid:** Zeigt dein Container noch „Passwort (optional)“ (`P5_PASSWORD`), mit REMOVE löschen – die Variable wird seit 0.0.3 nicht mehr benutzt; die Anmeldung legst du in den Einstellungen an.

### Einstellungen, Voreinstellungen, Anmeldung
* **Zahnrad** oben rechts (am Handy als Liste mit Gruppen): Allgemein, Welten & Farben, Voreinstellungen, Hardware, Anmeldung, Info
* **Voreinstellungen** (Audio und Video): Knopf „Als Voreinstellung speichern“ (Diskette) neben „Konvertierung starten“; in den Einstellungen umbenennen, sortieren, duplizieren, löschen, „Vorschlag“ an/aus und „Werte“ zum Bearbeiten
* **Welten & Farben**: Name, Farbe und Planet je Welt (wie bei p5assets), Reihenfolge
* **Anmeldung** wie bei p5assets: im Browser anlegen, „Angemeldet bleiben (30 Tage)“, Spaßmeldung nach falschem Passwort (abschaltbar), Passwort nur als Hash; vergessen: `docker exec -it p5converter p5converter auth reset`, `P5_AUTH_RESET=1` oder `/config/auth.json` löschen

### Logs
* **Terminal-Symbol** in der Kopfzeile: Log-Seite mit Suche, Stufenfilter, Live-Ansicht, Download und „Leeren“; Zähler für neue Warnungen/Fehler. Datei: `/config/logs/p5converter.log` (rotierend). Passwörter, Cookies und Tokens werden nie geschrieben.

### Ablauf in Schritten
* **Kopfzeile:** „Konvertieren“, „Umbenennen“ und „Verlauf“ (mit Zähler für laufende und wartende Aufträge) sind in jeder Ansicht erreichbar
* **Startseite:** oben der **aktuelle Auftrag** („Datei 4 von 13“ mit Fortschritt, Geschwindigkeit und Hardware mit grünen Haken) oder „Gerade nichts los“, daneben die Live-Auslastung; darunter gleich große Kacheln **Gewonnener Platz** (je Welt eigene Zählung, mit „Zurücksetzen“) und **Hardware**. Die Schritt-Reiter erscheinen erst, wenn man den Assistenten startet
* **Konvertieren:** Dateien → Ziel → Benennen → Einstellungen (Video: Video, dann Audio & Untertitel · Audio: Format) → **Zusammenfassung** → Start (Voreinstellungen gibt es nur im Schritt „Video“ bzw. „Einstellungen“; „Zurücksetzen“ stellt die gewählte Welt auf „Remux“ zurück); oben als Reiter anklickbar, unten Zurück/Weiter; danach zurück zur Startseite mit der laufenden Warteschlange

### Verlauf
* **Kopfzeile → Verlauf:** oben die Warteschlange (laufende und wartende Aufträge, „Parallel“, „Alle abbrechen“), darunter die letzten **100** beendeten Aufträge je Welt (Audio und Video getrennt, gespeichert in `/config`, bleibt nach „Fertige entfernen“ und Neustart): Ergebnis, Größe vorher/nachher, Dauer, Prüfergebnis, bei Fehlern ffmpeg-Befehl und Log · Suche, Filter nach Ergebnis und Zeitraum · **CSV-Export** · „Verlauf leeren“ (nur die gewählte Welt)

### Warteschlange (auf der Seite „Verlauf“)
* **Je Welt eine eigene Warteschlange** (Audio/Video) mit eigener Anzahl paralleler Aufträge; Farben: grün = geklappt, gelb = Hinweis/Ausweichweg, rot = Fehler; „Schreiben“/„Lesen“ mit Haken, wenn ffmpeg die Hardware bestätigt hat
* **Abbrechen räumt auf**: unfertige Datei und vom Auftrag neu angelegte leere Ordner werden gelöscht; Reste eines Absturzes beim nächsten Start; die Quelldatei bleibt unberührt
* **Auslastung** von CPU und Grafik/Videoeinheit live (auch im Leerlauf)

### Umbenennen
* **Namensmuster** mit Variablen (`{title}`, `{year}`, `{res}`, `{codec}`, `{bit}`, `{container}`, `{date}`, `{filename}`; Audio: `{artist}`, `{album}`, `{track}` …) und **Suchen & Ersetzen** (mehrere Regeln, einfacher Text, Groß-/Kleinschreibung egal) im Bereich „Ziel“, mit Live-Vorschau; beides lässt sich in Voreinstellungen speichern
* **Seite „Umbenennen“** (Kopfzeile): Dateien ohne Konvertierung umbenennen, mit Vorschau; es wird nie überschrieben oder verschoben

### Hardware-Encoding
* **Erkennung per echtem Test-Encode** (Quick Sync, NVENC, VAAPI, AMF – je Codec und 8/10 Bit), nicht nur „Encoder im ffmpeg vorhanden“
* „Automatisch“ oder festes Backend; ein nicht funktionierendes Backend wird **abgelehnt, nicht still durch die CPU ersetzt**
* **Nachweis der Nutzung:** pro Auftrag der von ffmpeg gemeldete Encoder („Schreiben: Quick Sync · hevc_qsv ✓“, dazu „Lesen: Hardware/CPU“), kompletter Befehl und Log; live CPU- und GPU-Auslastung (NVIDIA: `nvidia-smi` mit Encode/Decode-Engine · Intel: Status „Quick Sync: Leerlauf/aktiv“ aus sysfs-RC6 · AMD: `gpu_busy_percent`)
* Hardware-Decoding optional (bei Quick Sync, VAAPI und NVIDIA mit durchgängiger Hardware-Kette, daher „Lesen: … ✓“ nachweisbar); bei Fehlern probiert das Programm automatisch weitere Wege, zuletzt die CPU zum Lesen – ohne Fehlermeldung
* **Quick Sync auch auf älteren Intel-Chips** (Gen 8–11, z. B. i9-9900): das Image enthält die Media-SDK-Runtime *und* oneVPL (Gen 12+); die Erkennung probiert mehrere Startvarianten
* **Diagnose** unter Einstellungen → Hardware (Ergebnis jedes Tests, `vainfo`, GPUs) mit „Diagnose kopieren“

> Der Qualitätswert bei Hardware-Encodern (ICQ/CQ/QP) ist nicht 1:1 mit x264/x265-CRF vergleichbar; 20–28 sind üblich.

## Qualitätssicherung
Die CI führt Unit- und Integrationstests mit echtem ffmpeg aus (alle Software-Encoder, Audioformate, Spuren/Untertitel, Parallel-Kollisionen, Abbruch, Sicherheitsprüfungen) und startet das gebaute Docker-Image zu einem **Smoke-Test mit echten Konvertierungen**, bevor es veröffentlicht wird.
**GPU-Pfade (QSV/NVENC/VAAPI) sind implementiert, aber noch nicht auf echter Hardware geprüft** – bitte erste Läufe über „Details“ am Auftrag kontrollieren und Probleme melden.

## Sicherheit
Optionale Anmeldung (Hash des Passworts, Sitzungs-Cookie, Bremse bei Fehlversuchen). Schreibende API-Aufrufe verlangen JSON und dieselbe Herkunft (Schutz vor fremden Webseiten); Dateizugriff nur innerhalb von `P5_ROOTS`.

## Entwicklung
```bash
sh tools/precheck.sh          # Vorprüfung vor jedem Push (gofmt, vet, Windows-Build, JS-Syntax, Versionsstellen, Tests)
go test ./...                 # benötigt ffmpeg im PATH
go build -o p5converter . && P5_NO_BROWSER=1 ./p5converter   # http://127.0.0.1:8787
docker build -f docker/Dockerfile -t p5converter .
```
Umgebungsvariablen: `P5_LISTEN`, `P5_ROOTS`, `P5_JOBS`, `P5_CONFIG`, `P5_AUTH_RESET`, `P5_FFMPEG_DIR`, `P5_NO_BROWSER`, `PUID`, `PGID`.

## Roadmap
1. Unraid/Docker stabilisieren, Design verfeinern
2. Windows-App mit eigener Oberfläche
3. Linux-Desktop-App (Fedora KDE) mit eigener Oberfläche
