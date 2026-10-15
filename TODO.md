> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. Tag und Release nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Arbeitsregel (Nutzer): Bei „leg los“ nach grüner CI **direkt nach `main` mergen** (Pull Request, Squash). Ohne „leg los“ nichts mergen.
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Die Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie die echte Welt“) gilt hier **nicht**.
> Arbeitsregel (Nutzer): Ob die CI grün und das Image `:latest` gebaut ist, sieht der Nutzer selbst unter GitHub → Actions – nicht von selbst melden.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] **Warteschlange pro Welt trennen** (Nutzer): Audio und Video zeigen heute dieselbe Warteschlange → getrennte Listen je Welt (Aufträge nach `kind` filtern), ebenso Zähler/Fortschrittsring oben und „Alle abbrechen“/„Fertige entfernen“ nur für die aktuelle Welt; „Parallel“ ggf. je Welt
- [ ] **Auslastungsanzeige wirkt unglaubwürdig** (Nutzer): „Videoeinheit“ zeigt 100 % und CPU 14 %, obwohl nichts läuft, und nichts bewegt sich. Verdacht (ungeprüft): Messung läuft nur bei laufenden Aufträgen, im Leerlauf bleibt der letzte/ein falscher Wert stehen; Intel-Wert aus sysfs-RC6 evtl. falsch herum/ohne Basis berechnet. Ziel: im Leerlauf ehrlich „Leerlauf“/0 % bzw. „keine Messung“, live aktualisieren (auch Verlauf/Bewegung sichtbar), Quelle/Genauigkeit angeben; Wert nur anzeigen, wenn er verlässlich ist; Tests für die Berechnung
- [ ] **„+ Ersetzung“ ist buggy** (Nutzer): Löscht man alle Ersetzungen und fügt eine hinzu, erscheinen die gelöschten wieder. Ursache vermutet (im Code erkennbar): der „+ Ersetzung“-Knopf behält die alte Liste, nachdem „✕“ die Ansicht neu gebaut hat. Außerdem teilen sich **Audio und Video dieselben Ersetzungen/Muster** (ein gemeinsames Feld) → je Welt eigene Werte (Audio und Video klar getrennt, auch Namensmuster/Zusatz/Voreinstellungen). Sauber lösen und mit **UI-Tests** absichern (hinzufügen, löschen, alle löschen und neu hinzufügen, Welt wechseln, Voreinstellung laden, Neuladen) – in allen Ansichten prüfen
- [ ] **Abbrechen: Aufräumen prüfen/absichern** (Nutzer-Frage): Aktuell wird beim Abbrechen/Fehler die unfertige `.part`-Datei gelöscht (Zieldatei erst nach Erfolg umbenannt, Quelle bleibt unberührt). Lücken: (1) beim Absturz/Neustart des Containers mitten im Lauf bleibt die `.part`-Datei liegen → beim Start alte `.part`-Dateien im Zielordner aufräumen; (2) beim Abbrechen angelegte leere Zielordner bleiben stehen → leere, vom Auftrag neu angelegte Ordner wieder entfernen; (3) Test: Abbruch mitten im Lauf hinterlässt keine `.part`-Datei; (4) in der Oberfläche kurz erklären, was beim Abbrechen passiert
- [ ] **Warteschlange: Haken und Farben vereinheitlichen** (Nutzer, Screenshot): (1) Bei „Schreiben: Quick Sync · hevc_qsv ✓“ steht ein Haken, bei „Lesen: Quick Sync“ nicht – verwirrend: entweder bei beiden einen Haken (soweit ffmpeg es bestätigt; Decoder-Bestätigung aus dem ffmpeg-Log prüfen, z. B. Stream-Zeile `(hevc (hevc_qsv) …)`) oder den Haken erklären/weglassen; (2) Kacheln (Chips) farblich nach Ergebnis: **grün** = hat geklappt/bestätigt, **gelb** = Hinweis/Info/Ausweichweg (z. B. „Lesen: CPU“), **rot** = Fehler (Idee des Nutzers, Variante noch zu bestätigen)
- [ ] Branch-Modell: **erstmal nur `main`**, bis alles stabil läuft. Auf Zuruf des Nutzers dann wie p5assets: Feature-Branch → `dev` (Image `:dev`) → `main` (Image `:latest`); optional multi-arch (amd64/arm64)
- [ ] Design weiter verfeinern nach Rückmeldung vom Gerät (iPhone/iPad Safari und Web-App)
- [ ] Quick Sync (Intel Core i9-9900): Wirkung des Fixes in 0.0.3 beim Nutzer bestätigen; bleibt es „nicht nutzbar“, die kopierte Diagnose (Einstellungen → Hardware) auswerten

## Vom Nutzer zu prüfen (nicht in der Sandbox möglich)
- [ ] iPhone/iPad: Safari und Web-App (Safe-Areas, Statusleiste, Pull-to-Refresh) auf dem Gerät ansehen
- [ ] Quick Sync auf dem i9-9900: mit Hardware-Decoding an muss in der Warteschlange „Schreiben: Quick Sync …“ **und** „Lesen: Quick Sync“ stehen (auch mit Verkleinern/10 Bit); sonst „Details“ (Befehl, Log, Frühere Versuche) schicken
- [ ] GPU-Encoding auf echter Hardware prüfen (Intel Quick Sync und VAAPI auf dem i9-9900; NVIDIA via `--runtime=nvidia`): in „Details“ am Auftrag muss z. B. `hevc_qsv ✓ von ffmpeg bestätigt` stehen
- [ ] Unraid: leere optionale Pfade (Audio/Video) und neuer Pfad `/config` (Rechte) ausprobieren

## Später
- [ ] Windows-App mit eigener Oberfläche
- [ ] Linux-App (Fedora KDE) mit eigener Oberfläche

## Erledigt
- [x] 0.0.4: **Quick Sync lesen und schreiben** – durchgängige Hardware-Kette (`vpp_qsv`), danach „Bilder zurück in den Arbeitsspeicher“, danach CPU liest; Anzeige „Schreiben/Lesen“ getrennt, Zwischenfehler nur unter „Details → Frühere Versuche“, Laien-Wortwahl (Quick Sync steckt in der Intel-CPU)
- [x] 0.0.4: **Umbenennen** (Variante C): Namensmuster + Variablen + Suchen & Ersetzen im Konverter (Live-Vorschau, in Voreinstellungen speicherbar) und eigene Seite „Umbenennen“
- [x] 0.0.4: Standard-Voreinstellungen auf je 1 („Remux als MKV“ / „Remux als FLAC“); „Neu“ → „Neuigkeiten“; Symbole als einfarbige SVGs (größer, Matrix-Diskette), keine bunten Emojis außer Planeten; Hinweis zu `P5_PASSWORD` (Neuigkeiten, README, CHANGELOG)
- [x] 0.0.3: **Quick Sync zuverlässig erkennen** – Media-SDK-Runtime `libmfx1` (Gen 8–11) zusätzlich zu oneVPL im Image, mehrere Startvarianten mit Übernahme der funktionierenden beim Konvertieren, Diagnose-Ansicht (Tests, `vainfo`, GPUs, „Diagnose kopieren“), verständlichere Fehlermeldung; sichtbarer Device-Eintrag `/dev/dri` im Template
- [x] 0.0.3: **Einstellungen-Seite** (Allgemein, Welten & Farben, Voreinstellungen, Hardware, Anmeldung, Info), dauerhaft in `/config` (Variante A), neuer Pfad im Template
- [x] 0.0.3: **Voreinstellungen** (Audio und Video): speichern, bearbeiten, sortieren, Vorschläge wählen, Standard wiederherstellen
- [x] 0.0.3: **Anmeldung wie p5assets** (im Browser angelegt, Spaßmeldung, Passwort-Hash, Sitzungen, Bremse, Reset); `P5_PASSWORD` und Template-Eintrag entfernt
- [x] 0.0.2: Port 8787, Designlinie wie p5assets (Matrix-Theme, Welten mit Planeten, Übersicht, Handy/iPad, Web-App), Versionierung (Version, CHANGELOG, Neuigkeiten, Fußzeile)
- [x] ghcr-Paket ist öffentlich (geprüft)
- [x] v0.0.1 als Pre-Release (Docker-Image + Unraid-Template)
