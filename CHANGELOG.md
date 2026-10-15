# Änderungen

## 0.0.3 – 2026-10-15

**Neu**
- **Einstellungen** (Zahnrad oben rechts, am Handy als Liste mit Gruppen): Allgemein (Startansicht, Standard-Zielordner, parallele Aufträge, Neuigkeiten), Welten & Farben (Name, Farbe/Planet, Reihenfolge), Voreinstellungen, Hardware (bevorzugter Encoder, Erkennung, Diagnose), Anmeldung, Info
- **Voreinstellungen** für Audio und Video: Knopf „💾 Als Voreinstellung speichern“ neben „Konvertierung starten“; in den Einstellungen anlegen/umbenennen/sortieren/duplizieren/löschen, „Vorschlag“ an/aus (erscheint oben im Einstellungs-Panel), „✎ Werte“ bearbeitet eine Voreinstellung im Konverter, „Standard wiederherstellen“; neue Audio-Voreinstellungen
- **Anmeldung wie bei p5assets**, im Browser angelegt (Einstellungen → Anmeldung): Anmeldefenster mit „Angemeldet bleiben (30 Tage)“, Spaßmeldung nach falschem Passwort (abschaltbar), Passwort nur als Hash, Sitzungs-Cookie, Bremse bei Fehlversuchen, „Passwort vergessen?“ (`p5converter auth reset`, `P5_AUTH_RESET=1` oder `/config/auth.json` löschen)
- **Einstellungen dauerhaft auf dem Server** im neuen Pfad `/config` (gilt auf allen Geräten); ohne diesen Pfad zeigt die Oberfläche einen Hinweis
- **Hardware-Diagnose**: Ergebnis jedes Test-Encodes, `vainfo`-Zusammenfassung, GPUs und Render-Geräte; „📋 Diagnose kopieren“

**Geändert**
- **Quick Sync auf älteren Intel-Chips** (Gen 8–11, z. B. i9-9900): das Image enthält jetzt zusätzlich die Media-SDK-Runtime `libmfx1`; die Erkennung probiert mehrere Startvarianten (automatisch, `qsv=hw`, über VAAPI-Gerät) und nutzt die funktionierende auch beim Konvertieren; verständlichere Fehlermeldung
- **Unraid-Template**: neuer Pfad „Einstellungen“ (`/config`), sichtbarer Device-Eintrag `/dev/dri` statt Extra-Parameter; Eintrag „Passwort (optional)“ und `P5_PASSWORD` entfernt
- Parallele Aufträge bis 8; Farben und Welten-Namen stammen aus den Einstellungen
- Passwortfelder im Stil der Oberfläche

**Entfernt**
- `P5_PASSWORD` (Basic-Auth) – ersetzt durch die Anmeldung in der Oberfläche

## 0.0.2 – 2026-10-15

**Neu**
- Neues Design in der Linie von p5assets: Matrix-Theme mit Leuchteffekten, Farbe und Planet pro Welt (Audio grün, Video violett) mit Wurmloch-Flug beim Wechsel
- Übersicht oben: Fortschrittsring, Zähler (In Liste, Wartet, Läuft, Fertig, Fehler) und Live-Auslastung von CPU und GPU
- Handy und iPad: eigene Anordnung für Hoch- und Querformat, schwebende Startleiste, Spurenliste als Karten; als Web-App zum Home-Bildschirm hinzufügbar (Manifest, Icons, Safe-Areas)
- Fußzeile mit Version, Branch, Commit und ffmpeg-Version; Neuigkeiten-Anzeige (Knopf „Neu“ mit Punkt bei neuer Version)
- Meldungen als Toasts statt Text neben dem Knopf
- `CHANGELOG.md`, Versionsdatei (`internal/version`), Arbeitsregeln (`CLAUDE.md`) und Aufgabenliste (`TODO.md`)

**Geändert**
- Unraid-Template: bis zu **2 Audio-Ordner** (`/audio1`, `/audio2`) und **4 Video-Ordner** (`/video1` … `/video4`), alle optional; nicht eingehängte Ordner werden in der Dateiauswahl ausgeblendet
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
