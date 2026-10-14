# p5converter

Audio- und Video-Konverter mit Web-Oberfläche – ein SoundConverter-Klon mit zusätzlicher Video-Welt.
Ein einzelnes Go-Binary (nur Standardbibliothek) steuert **ffmpeg** an. Dieselbe Codebasis liefert

* **Docker-Image** (Unraid, Template unter `unraid/p5converter.xml`)
* **Windows-`.exe`** (Zip mit mitgeliefertem ffmpeg)
* **Linux-Binary** (Fedora KDE & Co.)

## Funktionen

### Audio (wie SoundConverter)
MP3, Ogg Vorbis, Opus, AAC/M4A, FLAC, WAV · VBR-Qualität oder konstante Bitrate · Samplerate/Kanäle ·
Tags und Cover werden übernommen · Ordner rekursiv hinzufügen · Zielordner mit Struktur oder
Namensmuster (`{artist}/{album}/{track} - {title}`; Platzhalter `artist album albumartist title track disc year genre filename`) ·
„Datei existiert“: umbenennen/überspringen/überschreiben · Quelle optional löschen.

### Video
* Container **MKV** (Standard) oder MP4, „Nur Remux“ (Video kopieren)
* Codec **H.264 (x264), H.265 (x265), AV1 (SVT-AV1/libaom), VP9**
* **Auflösung** (max. Höhe, nie hochskaliert), **CRF/Qualität**, Geschwindigkeits-Preset, **8/10 Bit** (oder „wie Quelle“, HDR-Quellen bleiben 10 Bit)
* **Audio**: Passthrough oder neu kodieren (AAC/Opus/AC-3/E-AC-3/FLAC), Sprachfilter, einzelne Spuren entfernen, Standard-Spur ändern
* **Untertitel**: Passthrough, alle entfernen, Sprachfilter, einzelne Spuren entfernen (Schriftarten-Anhänge bleiben in MKV erhalten)
* Pro Datei über **„Spuren“** auswählbar

### Hardware-Encoding (Intel Quick Sync, NVIDIA, AMD)
* **Automatische Erkennung per echtem Test-Encode** (nicht nur „Encoder im ffmpeg vorhanden“): Quick Sync (QSV), NVENC, VAAPI, AMF – je Codec (H.264/HEVC/AV1) und 8/10 Bit
* Auswahl „Automatisch“ oder festes Backend; ein nicht erkanntes Backend wird **abgelehnt, nicht still durch CPU ersetzt**
* **Nachweis, dass die Hardware genutzt wird**: pro Job der *von ffmpeg selbst gemeldete* Encoder (`hevc_qsv ✓ von ffmpeg bestätigt`), voller ffmpeg-Befehl und Log; live CPU- und GPU-Auslastung
  (NVIDIA: `nvidia-smi` inkl. Encode/Decode-Engine · Intel: sysfs-RC6 „GPU aktiv“ · AMD: `gpu_busy_percent` · Windows: Performance-Zähler der Video-Encode-Engine)
* Hardware-Decoding optional, mit automatischem Neuversuch ohne bei Fehlern

> Der Qualitätswert bei Hardware-Encodern (ICQ/CQ/QP) ist nicht 1:1 mit x264/x265-CRF vergleichbar; 20–28 sind übliche Werte.

## Docker / Unraid

```bash
docker run -d --name p5converter -p 8484:8484 \
  --device /dev/dri \
  -v /mnt/user:/media -v /mnt/user/appdata/p5converter/output:/output \
  ghcr.io/p5lukas/p5converter:latest
```
* `--device /dev/dri` reicht Intel Quick Sync / VAAPI durch.
* **NVIDIA**: zusätzlich `--runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all` (Unraid: Nvidia-Driver-Plugin).
* Oberfläche: `http://<server>:8484`. Optional `-e P5_PASSWORD=…` (Login-Name `p5`). Nicht ins Internet stellen.
* Der Browser sieht nur `/media` und `/output` (`P5_ROOTS`). `PUID`/`PGID` (Standard 99/100) bestimmen den Besitzer neuer Dateien.
* Unraid-Template: `unraid/p5converter.xml` nach `/boot/config/plugins/dockerMan/templates-user/` kopieren.
* Intel: Im Container-Log/„Hardware“-Karte steht, warum ein Backend nicht nutzbar ist (z. B. `/dev/dri` fehlt).

## Windows
Zip entpacken (enthält `p5converter.exe`, `ffmpeg.exe`, `ffprobe.exe`) und `p5converter.exe` starten – die Oberfläche öffnet sich im Browser.
Aktuelle GPU-Treiber installieren (Intel/NVIDIA/AMD); sie liefern QSV/NVENC/AMF.

## Fedora KDE
```bash
# ffmpeg mit x264/x265 und Hardware-Encodern (Fedoras ffmpeg-free kann das nicht):
sudo dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm \
                 https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-$(rpm -E %fedora).noarch.rpm
sudo dnf swap ffmpeg-free ffmpeg --allowerasing
sudo dnf install intel-media-driver libvpl   # Intel Quick Sync (nonfree)
tar xzf p5converter-linux-x64.tar.gz && ./install-linux.sh
```

## Aus dem Quellcode
```bash
go build -o p5converter .     # benötigt ffmpeg + ffprobe im PATH
./p5converter                  # http://127.0.0.1:8484
```
Optionen/Umgebungsvariablen: `-listen/P5_LISTEN`, `-roots/P5_ROOTS`, `-ffmpeg-dir/P5_FFMPEG_DIR`, `-jobs/P5_JOBS`, `-no-browser/P5_NO_BROWSER`, `P5_PASSWORD`.

## Stand / bekannte Lücken
* Software-Pfad (CPU) ist mit echten Dateien getestet. **GPU-Pfade (QSV/NVENC/VAAPI/AMF) und Windows-Messung sind implementiert, aber auf echter Hardware noch ungetestet** – bitte erste Läufe prüfen (Details-Ansicht eines Jobs zeigt den exakten ffmpeg-Befehl).
* Kein natives Fenster: Die Oberfläche läuft im Browser (Windows/Linux öffnen ihn automatisch).
