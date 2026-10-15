> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. Tag und Release nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Arbeitsregel (Nutzer): Bei „leg los“ nach grüner CI **direkt nach `main` mergen** (Pull Request, Squash). Ohne „leg los“ nichts mergen.
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Die Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie die echte Welt“) gilt hier **nicht**.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] **Symbole überarbeiten** (Nutzer): Zahnrad und Stern (Neuigkeiten) sind zu klein → größer; Diskette (Speichern) als **Matrix-Style-Diskette**; **keine bunten Emojis** mehr in der Oberfläche (Ausnahme: die Planeten, die bleiben) – stattdessen einfarbige Symbole im Theme
- [ ] **Unraid zeigt „Passwort (optional)“ (`P5_PASSWORD`) noch an** (Nutzer, Screenshot): Ursache (1) bis zum Merge von 0.0.3 enthielt die Vorlage auf `main` den Eintrag noch; (2) bestehende Container behalten alte Variablen auch mit neuer Vorlage – der Eintrag muss dort per **REMOVE** gelöscht werden (die Variable wird vom Programm seit 0.0.3 ignoriert, schadet also nicht). Ideen: Hinweis dazu in „Neuigkeiten“, README und Release-Text; prüfen, ob sich der Eintrag bei Neuinstallation wirklich nicht mehr zeigt
- [ ] Branch-Modell: **erstmal nur `main`**, bis alles stabil läuft. Auf Zuruf des Nutzers dann wie p5assets: Feature-Branch → `dev` (Image `:dev`) → `main` (Image `:latest`); optional multi-arch (amd64/arm64)
- [ ] Design weiter verfeinern nach Rückmeldung vom Gerät (iPhone/iPad Safari und Web-App)
- [ ] Quick Sync (Intel Core i9-9900): Wirkung des Fixes in 0.0.3 beim Nutzer bestätigen; bleibt es „nicht nutzbar“, die kopierte Diagnose (Einstellungen → Hardware) auswerten

## Vom Nutzer zu prüfen (nicht in der Sandbox möglich)
- [ ] iPhone/iPad: Safari und Web-App (Safe-Areas, Statusleiste, Pull-to-Refresh) auf dem Gerät ansehen
- [ ] GPU-Encoding auf echter Hardware prüfen (Intel Quick Sync und VAAPI auf dem i9-9900; NVIDIA via `--runtime=nvidia`): in „Details“ am Auftrag muss z. B. `hevc_qsv ✓ von ffmpeg bestätigt` stehen
- [ ] Unraid: leere optionale Pfade (Audio/Video) und neuer Pfad `/config` (Rechte) ausprobieren

## Später
- [ ] Windows-App mit eigener Oberfläche
- [ ] Linux-App (Fedora KDE) mit eigener Oberfläche

## Erledigt
- [x] 0.0.3: **Quick Sync zuverlässig erkennen** – Media-SDK-Runtime `libmfx1` (Gen 8–11) zusätzlich zu oneVPL im Image, mehrere Startvarianten mit Übernahme der funktionierenden beim Konvertieren, Diagnose-Ansicht (Tests, `vainfo`, GPUs, „Diagnose kopieren“), verständlichere Fehlermeldung; sichtbarer Device-Eintrag `/dev/dri` im Template
- [x] 0.0.3: **Einstellungen-Seite** (Allgemein, Welten & Farben, Voreinstellungen, Hardware, Anmeldung, Info), dauerhaft in `/config` (Variante A), neuer Pfad im Template
- [x] 0.0.3: **Voreinstellungen** (Audio und Video): speichern, bearbeiten, sortieren, Vorschläge wählen, Standard wiederherstellen
- [x] 0.0.3: **Anmeldung wie p5assets** (im Browser angelegt, Spaßmeldung, Passwort-Hash, Sitzungen, Bremse, Reset); `P5_PASSWORD` und Template-Eintrag entfernt
- [x] 0.0.2: Port 8787, Designlinie wie p5assets (Matrix-Theme, Welten mit Planeten, Übersicht, Handy/iPad, Web-App), Versionierung (Version, CHANGELOG, Neuigkeiten, Fußzeile)
- [x] ghcr-Paket ist öffentlich (geprüft)
- [x] v0.0.1 als Pre-Release (Docker-Image + Unraid-Template)
