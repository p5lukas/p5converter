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
  -v /mnt/user/musik:/audio1 -v /mnt/user/filme:/video1 -v /mnt/user/appdata/p5converter/output:/output \
  ghcr.io/p5lukas/p5converter:latest
```
* `--device /dev/dri` reicht Intel Quick Sync / VAAPI durch.
* **NVIDIA NVENC:** Nvidia-Driver-Plugin installieren, `--runtime=nvidia` bei „Extra Parameters“ ergänzen (`NVIDIA_VISIBLE_DEVICES=all` ist voreingestellt).
* Die Oberfläche sieht nur eingehängte Ordner: im Unraid-Template **2× Audio** (`/audio1`, `/audio2`), **4× Video** (`/video1` … `/video4`) – alle optional, leer lassen was nicht gebraucht wird – und den Zielordner `/output`. Per Kommandozeile geht auch ein einzelnes `/media`. Die Liste steht in `P5_ROOTS`; nicht eingehängte Ordner werden ausgeblendet. Die Quell-Ordner brauchen Schreibzugriff, wenn die Ergebnisse neben die Quelle sollen oder Quellen gelöscht werden. `PUID`/`PGID` (Standard 99/100) bestimmen den Besitzer neuer Dateien.
* Optional: `-e P5_PASSWORD=…` schützt die Oberfläche per Login (Benutzer `p5`). Trotzdem nicht ins Internet stellen.

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

### Hardware-Encoding
* **Erkennung per echtem Test-Encode** (Quick Sync, NVENC, VAAPI, AMF – je Codec und 8/10 Bit), nicht nur „Encoder im ffmpeg vorhanden“
* „Automatisch“ oder festes Backend; ein nicht funktionierendes Backend wird **abgelehnt, nicht still durch die CPU ersetzt**
* **Nachweis der Nutzung:** pro Auftrag der von ffmpeg gemeldete Encoder (`hevc_qsv ✓ von ffmpeg bestätigt`), kompletter Befehl und Log; live CPU- und GPU-Auslastung (NVIDIA: `nvidia-smi` mit Encode/Decode-Engine · Intel: sysfs-RC6 „GPU aktiv“ · AMD: `gpu_busy_percent`)
* Hardware-Decoding optional, bei Fehlern automatischer Neuversuch ohne

> Der Qualitätswert bei Hardware-Encodern (ICQ/CQ/QP) ist nicht 1:1 mit x264/x265-CRF vergleichbar; 20–28 sind üblich.

## Qualitätssicherung
Die CI führt Unit- und Integrationstests mit echtem ffmpeg aus (alle Software-Encoder, Audioformate, Spuren/Untertitel, Parallel-Kollisionen, Abbruch, Sicherheitsprüfungen) und startet das gebaute Docker-Image zu einem **Smoke-Test mit echten Konvertierungen**, bevor es veröffentlicht wird.
**GPU-Pfade (QSV/NVENC/VAAPI) sind implementiert, aber noch nicht auf echter Hardware geprüft** – bitte erste Läufe über „Details“ am Auftrag kontrollieren und Probleme melden.

## Sicherheit
Keine Anmeldung ohne `P5_PASSWORD`. Schreibende API-Aufrufe verlangen JSON und dieselbe Herkunft (Schutz vor fremden Webseiten); Dateizugriff nur innerhalb von `P5_ROOTS`.

## Entwicklung
```bash
go test ./...                 # benötigt ffmpeg im PATH
go build -o p5converter . && P5_NO_BROWSER=1 ./p5converter   # http://127.0.0.1:8787
docker build -f docker/Dockerfile -t p5converter .
```
Umgebungsvariablen: `P5_LISTEN`, `P5_ROOTS`, `P5_JOBS`, `P5_PASSWORD`, `P5_FFMPEG_DIR`, `P5_NO_BROWSER`, `PUID`, `PGID`.

## Roadmap
1. Unraid/Docker stabilisieren, Design verfeinern
2. Windows-App mit eigener Oberfläche
3. Linux-Desktop-App (Fedora KDE) mit eigener Oberfläche
