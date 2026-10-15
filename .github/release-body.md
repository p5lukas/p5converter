## p5converter – Vorabversion (Pre-Release)

Audio- und Video-Konverter mit Web-Oberfläche für **Unraid / Docker**. Ein SoundConverter-Klon plus Video-Welt (MKV, x264/x265/AV1, CRF, 10 Bit, Auflösung, Audio-/Untertitel-Spuren) und GPU-Encoding (Intel Quick Sync, NVIDIA NVENC, VAAPI).

### Installation (Unraid)
1. Template laden: `unraid/p5converter.xml` aus diesem Release in `/boot/config/plugins/dockerMan/templates-user/` kopieren, danach in Unraid **Docker → Container hinzufügen → p5converter** wählen.
2. Pfade prüfen (`/media` = deine Medien, `/output` = Zielordner) und **Apply**.
3. Weboberfläche: `http://<unraid-ip>:8787`

Oder per Kommandozeile:
```bash
docker run -d --name p5converter -p 8787:8787 \
  --device /dev/dri \
  -v /mnt/user:/media -v /mnt/user/appdata/p5converter/output:/output \
  ghcr.io/p5lukas/p5converter:latest
```
* Intel Quick Sync / VAAPI: `--device /dev/dri` (im Template voreingestellt).
* NVIDIA NVENC: Nvidia-Driver-Plugin installieren und bei „Extra Parameters“ `--runtime=nvidia` ergänzen.
* Im Bereich **Hardware** der Oberfläche siehst du, welche Encoder wirklich funktionieren (echter Test-Encode) – und warum nicht, falls einer fehlt.

### Bekannt / ungetestet
* Software-Encoding (CPU) und Audio sind automatisiert getestet (inkl. Docker-Image-Smoketest in der CI).
* **GPU-Encoding (QSV/NVENC/VAAPI) wurde noch nicht auf echter Hardware geprüft.** Bitte erste Läufe über „Details“ am Auftrag kontrollieren (zeigt den von ffmpeg bestätigten Encoder und den kompletten Befehl) und Probleme melden.
* Keine Windows-/Linux-Desktop-App in diesem Release (geplant, mit eigener Oberfläche).
* Die Oberfläche hat keine Anmeldung. Nicht ins Internet stellen; optional `P5_PASSWORD` setzen.
