# Änderungen

## 0.0.2 – 2026-10-15

**Neu**
- Neues Design in der Linie von p5assets: Matrix-Theme mit Leuchteffekten, Farbe und Planet pro Welt (Audio grün, Video violett) mit Wurmloch-Flug beim Wechsel
- Übersicht oben: Fortschrittsring, Zähler (In Liste, Wartet, Läuft, Fertig, Fehler) und Live-Auslastung von CPU und GPU
- Handy und iPad: eigene Anordnung für Hoch- und Querformat, schwebende Startleiste, Spurenliste als Karten; als Web-App zum Home-Bildschirm hinzufügbar (Manifest, Icons, Safe-Areas)
- Fußzeile mit Version, Branch, Commit und ffmpeg-Version; Neuigkeiten-Anzeige (Knopf „Neu“ mit Punkt bei neuer Version)
- Meldungen als Toasts statt Text neben dem Knopf
- `CHANGELOG.md`, Versionsdatei (`internal/version`), Arbeitsregeln (`CLAUDE.md`) und Aufgabenliste (`TODO.md`)

**Geändert**
- Standard-Port ist jetzt **8787** (Programm, Docker, Unraid-Template; im Template Container-Port und Mapping anpassen)
- Info-Punkte (ⓘ) im neuen Stil, Popover bleibt beim leichten Scrollen auf dem Handy stehen
- Docker-Build übernimmt Branch, Tag und Commit in die Versionsanzeige
- Die CI prüft im Smoke-Test zusätzlich Version, Neuigkeiten, Manifest und Icons

**Behoben**
- Abgebrochene Aufträge zeigten einen ffmpeg-Logtext als Fehler an

## 0.0.1 – 2026-10-15 (Pre-Release)

**Neu**
- Erste Version: Audio-Welt (MP3, Ogg, Opus, AAC, FLAC, WAV) und Video-Welt (MKV/MP4, x264/x265/AV1/VP9, CRF, 10 Bit, Auflösung, Audio-/Untertitel-Spuren)
- Hardware-Erkennung per Test-Encode (Quick Sync, NVENC, VAAPI, AMF) mit Nachweis der Nutzung
- Info-Hilfe zu jeder Einstellung, Docker-Image und Unraid-Template
