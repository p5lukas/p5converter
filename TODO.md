> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. Tag und Release nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Arbeitsregel (Nutzer): Bei „leg los“ nach grüner CI **nach `dev` mergen** (Pull Request, Squash; Image `:dev`, dort testet der Nutzer zuerst). **Nach `main` nur, wenn der Nutzer es sagt** („passt so, nach main“; Pull Request `dev` → `main`, Merge-Commit). Wie bei p5assets.
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen; je ein Pre-Release von `main` (`vX.Y.Z`) und von `dev` (`vX.Y.Z-dev`).
> Entscheidung (Nutzer): Die **Windows-App entsteht erstmal nur auf `dev`**.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Die Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie die echte Welt“) gilt hier **nicht**.
> Arbeitsregel (Nutzer): Ob die CI grün und das Image `:latest` gebaut ist, sieht der Nutzer selbst unter GitHub → Actions – nicht von selbst melden.
> Arbeitsregel (Nutzer): In `p5lukas/p5assets` darf ich **immer lesen**; **ändern nur, wenn der Nutzer es ausdrücklich sagt**.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] **Windows-App (zuerst nur auf `dev`)** (Nutzer): **Entscheidung Nutzer: Variante B** – eigenes App-Fenster (Edge-WebView2) mit **derselben Weboberfläche wie im Unraid-Browser** (gleiches Aussehen, ein Code für alles), Symbol im Infobereich (Tray) mit „Öffnen/Beenden“. **Auslieferung (Nutzer): genau EINE Datei `p5converter-setup.exe`, die alles enthält** (Programm, `ffmpeg.exe`, Symbole): keine weiteren Dateien, kein Entpacken, **kein `portable.zip`**; Setup starten, durchlaufen lassen, danach ist alles bereit zum Konvertieren – **Hardware wird automatisch erkannt** (Quick Sync, NVIDIA NVENC, AMD AMF per echtem Test-Encode wie unter Docker; VAAPI entfällt unter Windows). Technik/Plan: Go-Programm im „Desktop-Modus“ + WebView2-Fenster ohne cgo (Cross-Compile aus Linux/CI möglich), statisches `ffmpeg.exe` (BtbN-GPL-Build mit NVENC/QSV/AMF) im Installer, Installer mit Inno Setup (ein `setup.exe`, LZMA, Startmenü, Deinstallation), Einstellungen/Logs unter `%APPDATA%\p5converter`, Datei-Browser mit Laufwerken (vorhanden), Einzelinstanz (zweiter Start holt das Fenster nach vorn), Beenden über Tray; WebView2-Laufzeit prüfen und bei Fehlen nachinstallieren; Bau in GitHub Actions (`windows-latest`), Ergebnis als Anhang/Artefakt; **Größe der `setup.exe` nach dem ersten Bau messen und nennen**; nicht nach `main`, bis der Nutzer es freigibt; Windows-Pfade (Laufwerksbuchstaben, `\`) per Go-Tests, echte Prüfung nur auf dem Windows-PC des Nutzers. Details (Nutzer fand die Optionen zu kompliziert → einfache Standardwerte festgelegt): **ohne Zertifikat** (einmal SmartScreen-Hinweis „Weitere Informationen → Trotzdem ausführen“, gilt für jede heruntergeladene unsignierte .exe, auch portable), Installation **nur für den Benutzer ohne Admin-Abfrage** (`%LOCALAPPDATA%`, Startmenü, Desktop-Symbol und Autostart als Haken im Installer, Autostart standardmäßig aus), Download vom `dev` als laufende Vorabversion **`dev-latest`** (fester Link, wird nach jedem Merge nach `dev` ersetzt), WebView2: **Starter im Installer**, lädt die Komponente nur bei Fehlen nach
- [ ] Optional: Image als multi-arch (amd64/arm64) bauen

## Vom Nutzer zu prüfen (nicht in der Sandbox möglich)
- [ ] 0.0.10: Schritt „Audio & Untertitel“ auf dem Gerät ansehen (Desktop und iPhone/iPad, hoch und quer): Ist jetzt klar, was „So lassen / Kleiner machen“ bedeutet? Sind „Erweitert“ (Titel, Sprache, Forced, startet automatisch) und die Tipps verständlich? Eine echte Datei mit mehreren Sprachen ausprobieren, auch „Kleiner machen“ (Zielbitrate stimmt mit der Anzeige?) und danach in Plex neu analysieren
- [ ] 0.0.10: „Gewonnener Platz“ in Audio und Video getrennt ansehen; „Zurücksetzen“ in einer Welt (Rückfrage, andere Welt bleibt)
- [ ] 0.0.10: Nach dem Update einmal den Hinweis „Neu in Version 0.0.10“ sehen (nur einmal, auf anderen Geräten nicht noch einmal); „Alle ansehen“ und Fußzeile „Neuigkeiten“ öffnen die Liste
- [ ] 0.0.10: Unraid-Vorlage neu laden und die GPU-Anleitung unter „Overview“ lesen; Einstellungen → Hardware → „Wie schalte ich meine GPU frei?“
- [x] Neues Icon: auf iPhone/iPad die Web-App einmal vom Home-Bildschirm löschen und neu hinzufügen (iOS merkt sich das alte Icon); in Unraid wird das Icon aus `unraid/icon.png` auf `main` geholt (Container ggf. neu anlegen/„Force Update“) (Nutzer 16.10.: passt)
- [x] Log-Seite auf dem Server ansehen: nach einer Konvertierung stehen Start/Ende/Fehler im Log, Zähler am Terminal-Symbol (Nutzer: passt)
- [x] Neuen Ablauf auf iPhone/iPad ansehen (Reiter-Leiste scrollt, Zurück/Weiter-Leiste unten, Safe-Areas in der Web-App) (Nutzer: passt)
- [x] Auslastungsanzeige auf dem Unraid-Server ansehen: im Leerlauf soll die CPU kleine, wechselnde Werte zeigen; „Grafik aktiv“ (Intel) im Leerlauf niedrig, beim Konvertieren hoch. Falls der Intel-Wert weiter nicht stimmt: Diagnose (Einstellungen → Hardware) schicken (Nutzer: passt; wird mit der Intel-Statusanzeige noch überarbeitet)
- [x] iPhone/iPad: Safari und Web-App (Safe-Areas, Statusleiste, Pull-to-Refresh) auf dem Gerät ansehen (Nutzer: Safe-Areas/Statusleiste ok; Pull-to-Refresh geht nicht → eigener Eintrag unter „Offen“)
- [x] Quick Sync auf dem i9-9900: mit Hardware-Decoding an muss in der Warteschlange „Schreiben: Quick Sync …“ **und** „Lesen: Quick Sync“ stehen (auch mit Verkleinern/10 Bit); sonst „Details“ (Befehl, Log, Frühere Versuche) schicken (Nutzer 16.10.: Quick Sync scheint zu klappen; Screenshot zeigt „Schreiben“ und „Lesen“ per Quick Sync)
- [x] GPU-Encoding auf echter Hardware prüfen (Intel Quick Sync und VAAPI auf dem i9-9900; NVIDIA via `--runtime=nvidia`): in „Details“ am Auftrag muss z. B. `hevc_qsv ✓ von ffmpeg bestätigt` stehen (Nutzer: VAAPI schreiben klappt; „Lesen: VAAPI“ ohne Haken → eigener Eintrag; NVIDIA kann der Nutzer erst mit der Windows-App testen)
- [x] Unraid: leere optionale Pfade (Audio/Video) und neuer Pfad `/config` (Rechte) ausprobieren (Nutzer: passt)

## Später
- [ ] Windows-App mit eigener Oberfläche (zuerst nur auf `dev`)
- [ ] Linux-App (Fedora KDE) mit eigener Oberfläche

## Erledigt
- [x] 0.1.0: **Branch-Modell wie p5assets**: Feature-Branch → `dev` (Image `:dev`, Vorlage `p5converter-dev.xml`) → `main` (Image `:latest`); Pre-Releases `v0.1.0` und `v0.1.0-dev`
- [x] 0.0.10: **Audio & Untertitel verständlich** (Variante C): Klartext-Karten, „So lassen/Kleiner machen“, „Erweitert“, Tipps-Assistent, vorausgefüllte Empfehlungen mit angezeigter Zielbitrate, korrigierter Info-Text (5.1 = 3×)
- [x] 0.0.10: **Gewonnener Platz strikt je Welt** + Zurücksetzen je Welt (mit Rückfrage)
- [x] 0.0.10: **Neuigkeiten wie bei p5assets** (Hinweis einmal pro Version, Merker auf dem Server, Punkt entfällt)
- [x] 0.0.10: **Unraid-Vorlage/README/Einstellungen: GPU-Anleitung** (Intel/AMD `/dev/dri`, NVIDIA `--runtime=nvidia`)
- [x] 0.0.9: **Audio & Untertitel als ein Schritt** mit Spurtabelle (Behalten, Aktion/Neu kodieren je Tonspur, Titel, Sprache ISO 639-2, Forced, Standard), „Alle auswählen/abwählen“ (auch Datei-Browser, Vorschläge), „Auf alle Dateien anwenden“, Plex-Hinweise; Dialog „Spuren“ entfällt
- [x] 0.0.9: **Alles zurücksetzen** (je Welt, Standard Remux), **Ziehen zum Aktualisieren** (Web-App), **Lesen per VAAPI/NVIDIA nachweisbar**, **„Wenn Datei existiert“** verständlich, **Farbflackern** behoben, **Intel-Status** „Leerlauf/aktiv“, **Voreinstellungen nur im Einstellungs-Schritt**, **Hardware-Kachel** aufgeräumt, **Tab-Icons** versioniert (p5converter + p5assets 0.4.9), **Neuigkeiten** nur in der Fußzeile
- [x] Quick Sync auf dem i9-9900 (Nutzer-Rückmeldung: scheint zu klappen, Lesen und Schreiben); Geschwindigkeit geklärt: S01E02 (36:41 min) in 6:26 min = ca. 5,7× (≈137 fps), gleich schnell wie der Lauf mit Software-Lesen (5,8×) → das Lesen ist nicht der Engpass, der Encoder (hevc_qsv, Preset „slow“) bestimmt das Tempo; der Anfangswert 2,8× war nur die Anlaufphase
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
