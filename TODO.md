> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. Tag und Release nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Arbeitsregel (Nutzer): Bei „leg los“ nach grüner CI **direkt nach `main` mergen** (Pull Request, Squash). Ohne „leg los“ nichts mergen.
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Die Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie die echte Welt“) gilt hier **nicht**.
> Arbeitsregel (Nutzer): Ob die CI grün und das Image `:latest` gebaut ist, sieht der Nutzer selbst unter GitHub → Actions – nicht von selbst melden.
> Arbeitsregel (Nutzer): In `p5lukas/p5assets` darf ich **immer lesen**; **ändern nur, wenn der Nutzer es ausdrücklich sagt**.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] Branch-Modell: **erstmal nur `main`**, bis alles stabil läuft. Auf Zuruf des Nutzers dann wie p5assets: Feature-Branch → `dev` (Image `:dev`) → `main` (Image `:latest`); optional multi-arch (amd64/arm64)
- [ ] Design weiter verfeinern nach Rückmeldung vom Gerät (iPhone/iPad Safari und Web-App)
- [ ] Quick Sync (Intel Core i9-9900): Wirkung des Fixes in 0.0.3 beim Nutzer bestätigen; bleibt es „nicht nutzbar“, die kopierte Diagnose (Einstellungen → Hardware) auswerten

## Vom Nutzer zu prüfen (nicht in der Sandbox möglich)
- [ ] Neues Icon: auf iPhone/iPad die Web-App einmal vom Home-Bildschirm löschen und neu hinzufügen (iOS merkt sich das alte Icon); in Unraid wird das Icon aus `unraid/icon.png` auf `main` geholt (Container ggf. neu anlegen/„Force Update“)
- [ ] Log-Seite auf dem Server ansehen: nach einer Konvertierung stehen Start/Ende/Fehler im Log, Zähler am Terminal-Symbol
- [ ] Neuen Ablauf auf iPhone/iPad ansehen (Reiter-Leiste scrollt, Zurück/Weiter-Leiste unten, Safe-Areas in der Web-App)
- [ ] Auslastungsanzeige auf dem Unraid-Server ansehen: im Leerlauf soll die CPU kleine, wechselnde Werte zeigen; „Grafik aktiv“ (Intel) im Leerlauf niedrig, beim Konvertieren hoch. Falls der Intel-Wert weiter nicht stimmt: Diagnose (Einstellungen → Hardware) schicken
- [ ] iPhone/iPad: Safari und Web-App (Safe-Areas, Statusleiste, Pull-to-Refresh) auf dem Gerät ansehen
- [ ] Quick Sync auf dem i9-9900: mit Hardware-Decoding an muss in der Warteschlange „Schreiben: Quick Sync …“ **und** „Lesen: Quick Sync“ stehen (auch mit Verkleinern/10 Bit); sonst „Details“ (Befehl, Log, Frühere Versuche) schicken
- [ ] GPU-Encoding auf echter Hardware prüfen (Intel Quick Sync und VAAPI auf dem i9-9900; NVIDIA via `--runtime=nvidia`): in „Details“ am Auftrag muss z. B. `hevc_qsv ✓ von ffmpeg bestätigt` stehen
- [ ] Unraid: leere optionale Pfade (Audio/Video) und neuer Pfad `/config` (Rechte) ausprobieren

## Später
- [ ] Windows-App mit eigener Oberfläche
- [ ] Linux-App (Fedora KDE) mit eigener Oberfläche

## Erledigt
- [x] 0.0.8: **Endgültiges App-Icon**: zwei zentrierte Discs (silberne Audio-CD + blaue Blu-ray) als Abzeichen; in allen Größen, Einstellungen → Info, README, Release-Text, Unraid-Icon. p5assets: oranger Komet (0.4.8 auf `dev`)
- [x] 0.0.7: **Log-Fenster wie bei p5assets** (Seite, Kopfzeilen-Symbol mit Zähler, rotierendes Protokoll, Schwärzung von Geheimnissen)
- [x] 0.0.7: **App-Icon wie p5assets** mit Abzeichen (zwei Pfeile) in allen Größen inkl. Apple-Touch- und Unraid-Icon; p5assets bekommt das Feuerball-Abzeichen im selben Aufbau (eigener Stand dort)
- [x] 0.0.7: Beide Repos: Icon-Erzeugung als Skript (`tools/icons/make_icons.py`)
- [x] 0.0.6: **Ablauf in Schritten** (Variante C, mit Zusammenfassung): Startseite (Statistik, Hardware, gewonnener Platz, Warteschlange, „Konvertierung starten“/„Umbenennen starten“), Schritte je Welt, Rückkehr zur Startseite nach dem Start; „Umbenennen“ aus der Kopfzeile entfernt
- [x] 0.0.5: **Warteschlange je Welt getrennt** (eigene Parallelität, Zähler, Abbrechen/Entfernen je Welt)
- [x] 0.0.5: **Auslastungsanzeige** dauernd live gemessen, ehrlich bei fehlender Messung (Ursache: Messung nur während Aufträgen → alter Wert blieb stehen)
- [x] 0.0.5: **„+ Ersetzung“ repariert**, Muster/Zusatz/Ersetzungen je Welt getrennt, UI-Test (`tools/ui-check-world.js`)
- [x] 0.0.5: **Haken bei „Lesen“** (ffmpeg-bestätigter Hardware-Decoder) und **Farben** grün/gelb/rot für Karten und Kacheln
- [x] 0.0.5: **Abbrechen räumt auf** (`.part`, leere neue Ordner, Reste nach Absturz beim Start), Tests
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
