# p5converter

Audio- und Video-Konverter mit Web-Oberfläche für **Unraid / Docker** – ein SoundConverter-Klon mit zusätzlicher Video-Welt.
Ein einzelnes Go-Programm (nur Standardbibliothek) steuert **ffmpeg** an; das Docker-Image bringt alles mit (ffmpeg mit x264/x265/SVT-AV1, Intel-/AMD-Treiber für Quick Sync/VAAPI).

> **Status: v0.0.x Vorabversion** (aktuell 0.0.2, siehe `CHANGELOG.md`). Windows- und Linux-Desktop-App (mit eigener Oberfläche) folgen später.

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
* **NVIDIA NVENC:** Nvidia-Driver-Plugin installieren, `--runtime=nvidia` bei „Extra Parameters“ ergänzen (`NVIDIA_VISIBLE_DEVICES=all` ist voreingestellt).
* Die Oberfläche sieht nur eingehängte Ordner: im Unraid-Template **2× Audio** (`/audio1`, `/audio2`), **4× Video** (`/video1` … `/video4`) – alle optional, leer lassen was nicht gebraucht wird – und den Zielordner `/output`. Per Kommandozeile geht auch ein einzelnes `/media`. Die Liste steht in `P5_ROOTS`; nicht eingehängte Ordner werden ausgeblendet. Die Quell-Ordner brauchen Schreibzugriff, wenn die Ergebnisse neben die Quelle sollen oder Quellen gelöscht werden. `PUID`/`PGID` (Standard 99/100) bestimmen den Besitzer neuer Dateien.
* Anmeldung (optional): wird in der Oberfläche unter **Einstellungen → Anmeldung** angelegt, nicht per Umgebungsvariable. Trotzdem nicht ins Internet stellen.

## Funktionen

### Design
Gleiche Designlinie wie [p5assets](https://github.com/p5lukas/p5assets): Matrix-Theme, Audio und Video als eigene **Welten** mit Farbe und Planet (Wurmloch-Flug beim Wechsel), Übersicht mit Fortschrittsring und Live-Auslastung, Version und Neuigkeiten in der Fußzeile.
Läuft auf Desktop, Handy und iPad (Hoch-/Querformat); auf iPhone/iPad per **Teilen → Zum Home-Bildschirm** als Web-App.

### Hilfe für Einsteiger
Jede Einstellung hat einen kleinen **ⓘ**-Punkt mit einfacher Erklärung und Beispielen (z. B. wann 10 Bit sinnvoll ist).

### Audio (wie SoundConverter)
MP3, Ogg Vorbis, Opus, AAC/M4A, FLAC, WAV · VBR-Qualität oder konstante Bitrate · Samplerate/Kanäle · Tags und Cover bleiben erhalten · Ordner rekursiv hinzufügen ·
Zielordner mit Struktur oder Namensmuster (`{artist}/{album}/{track} - {title}`) · „Datei existiert“: umbenennen/überspringen/überschreiben · Quelle optional löschen (nur nach Prüfung der Ergebnis-Laufzeit).

### Video
* Container **MKV** (Standard) oder MP4, „Nur Remux“ (Video kopieren)
* Codec **H.264, H.265, AV1, VP9**
* **Auflösung** (max. Höhe, nie hochskaliert), **CRF**, Geschwindigkeits-Preset, **8/10 Bit** (oder „wie Quelle“)
* **Audio:** Passthrough oder neu kodieren, Sprachfilter, einzelne Spuren entfernen, Standard-Spur ändern
* **Untertitel:** Passthrough, alle entfernen, Sprachfilter, einzelne Spuren entfernen (Schriftarten-Anhänge bleiben in MKV erhalten)
* Pro Datei über **„Spuren“** einstellbar

> **Unraid:** Zeigt dein Container noch „Passwort (optional)“ (`P5_PASSWORD`), mit REMOVE löschen – die Variable wird seit 0.0.3 nicht mehr benutzt; die Anmeldung legst du in den Einstellungen an.

### Einstellungen, Voreinstellungen, Anmeldung
* **Zahnrad** oben rechts (am Handy als Liste mit Gruppen): Allgemein, Welten & Farben, Voreinstellungen, Hardware, Anmeldung, Info
* **Voreinstellungen** (Audio und Video): Knopf „Als Voreinstellung speichern“ (Diskette) neben „Konvertierung starten“; in den Einstellungen umbenennen, sortieren, duplizieren, löschen, „Vorschlag“ an/aus und „Werte“ zum Bearbeiten
* **Welten & Farben**: Name, Farbe und Planet je Welt (wie bei p5assets), Reihenfolge
* **Anmeldung** wie bei p5assets: im Browser anlegen, „Angemeldet bleiben (30 Tage)“, Spaßmeldung nach falschem Passwort (abschaltbar), Passwort nur als Hash; vergessen: `docker exec -it p5converter p5converter auth reset`, `P5_AUTH_RESET=1` oder `/config/auth.json` löschen

### Ablauf in Schritten
* **Startseite:** Statistik, Auslastung, Hardware, **gewonnener Platz** (Summe aller bisher gesparten Größen) und Warteschlange, dazu „Konvertierung starten“ und „Umbenennen starten“
* **Konvertieren:** Dateien → Ziel → Benennen → Einstellungen (Video: Video, dann Audio & Untertitel · Audio: Format) → **Zusammenfassung** → Start; oben als Reiter anklickbar, unten Zurück/Weiter; danach zurück zur Startseite mit der laufenden Warteschlange

### Warteschlange
* **Je Welt eine eigene Warteschlange** (Audio/Video) mit eigener Anzahl paralleler Aufträge; Farben: grün = geklappt, gelb = Hinweis/Ausweichweg, rot = Fehler; „Schreiben“/„Lesen“ mit Haken, wenn ffmpeg die Hardware bestätigt hat
* **Abbrechen räumt auf**: unfertige Datei und vom Auftrag neu angelegte leere Ordner werden gelöscht; Reste eines Absturzes beim nächsten Start; die Quelldatei bleibt unberührt
* **Auslastung** von CPU und Grafik/Videoeinheit live (auch im Leerlauf)

### Umbenennen
* **Namensmuster** mit Variablen (`{title}`, `{year}`, `{res}`, `{codec}`, `{bit}`, `{container}`, `{date}`, `{filename}`; Audio: `{artist}`, `{album}`, `{track}` …) und **Suchen & Ersetzen** (mehrere Regeln, optional Regex/Groß-/Kleinschreibung) im Bereich „Ziel“, mit Live-Vorschau; beides lässt sich in Voreinstellungen speichern
* **Seite „Umbenennen“** (Kopfzeile): Dateien ohne Konvertierung umbenennen, mit Vorschau; es wird nie überschrieben oder verschoben

### Hardware-Encoding
* **Erkennung per echtem Test-Encode** (Quick Sync, NVENC, VAAPI, AMF – je Codec und 8/10 Bit), nicht nur „Encoder im ffmpeg vorhanden“
* „Automatisch“ oder festes Backend; ein nicht funktionierendes Backend wird **abgelehnt, nicht still durch die CPU ersetzt**
* **Nachweis der Nutzung:** pro Auftrag der von ffmpeg gemeldete Encoder („Schreiben: Quick Sync · hevc_qsv ✓“, dazu „Lesen: Hardware/CPU“), kompletter Befehl und Log; live CPU- und GPU-Auslastung (NVIDIA: `nvidia-smi` mit Encode/Decode-Engine · Intel: sysfs-RC6 „GPU aktiv“ · AMD: `gpu_busy_percent`)
* Hardware-Decoding optional (bei Quick Sync mit durchgängiger Hardware-Kette); bei Fehlern probiert das Programm automatisch weitere Wege, zuletzt die CPU zum Lesen – ohne Fehlermeldung
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
go test ./...                 # benötigt ffmpeg im PATH
go build -o p5converter . && P5_NO_BROWSER=1 ./p5converter   # http://127.0.0.1:8787
docker build -f docker/Dockerfile -t p5converter .
```
Umgebungsvariablen: `P5_LISTEN`, `P5_ROOTS`, `P5_JOBS`, `P5_CONFIG`, `P5_AUTH_RESET`, `P5_FFMPEG_DIR`, `P5_NO_BROWSER`, `PUID`, `PGID`.

## Roadmap
1. Unraid/Docker stabilisieren, Design verfeinern
2. Windows-App mit eigener Oberfläche
3. Linux-Desktop-App (Fedora KDE) mit eigener Oberfläche
