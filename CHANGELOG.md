# Änderungen

## 0.1.0 – 2026-10-16

**Erste getestete Vorabversion (Pre-Release)** – Quick Sync und VAAPI laufen auf echter Hardware; Ablauf, Spuren-Editor, Statistik, Neuigkeiten und Oberfläche sind abgenommen.

**Neu**
- **Zwei Kanäle wie bei p5assets**: Image `:dev` (Branch `dev`, zum Testen) und `:latest` (Branch `main`, stabil); eigene Unraid-Vorlage `unraid/p5converter-dev.xml` für `:dev`
- Neue Funktionen kommen zuerst auf `dev` und werden erst nach Freigabe nach `main` übernommen

**Geändert**
- Version 0.1.0 (Sprung der mittleren Stelle) → Tag und Pre-Release; zusätzlich Pre-Release `v0.1.0-dev` vom Branch `dev`

## 0.0.10 – 2026-10-16

**Neu**
- **Audio & Untertitel verständlich** (Variante C): Der Schritt sagt zuerst, dass nichts geändert werden muss. Jede Spur ist eine Karte mit Klartext („Deutsch · Dolby Digital 5.1 · 6 Kanäle“), Behalten-Häkchen und bei Ton „So lassen (empfohlen) / Kleiner machen (neu kodieren)“; Titel, Sprache (Auswahl mit Namen), Forced und „startet automatisch“ stehen hinter „Erweitert“. **Tipps zu dieser Datei** per Knopfdruck: nur Deutsch und Englisch behalten, Forced-Untertitel ohne Markierung markieren, fehlende Sprache festlegen
- Beim Kleinermachen sind **Format und Bitrate vorausgefüllt** (AAC 160 kbit/s je Stereo-Paar) und die **Zielbitrate wird angezeigt** (z. B. 5.1 → 480 kbit/s); Warnung bei verlustfreiem Ton (TrueHD, FLAC, DTS-HD)
- **Gewonnener Platz strikt je Welt**: Audio zeigt nur Audio, Video nur Video; „Zurücksetzen“ (mit Rückfrage) je Welt; „seit“-Datum je Welt (alte Zählung wird übernommen)
- **Neuigkeiten wie bei p5assets**: nach einem Update einmal pro Version ein kurzer Hinweis („Neu in Version X“ mit den Überschriften, „Alle ansehen“/„Schließen“); der Merker liegt auf dem Server (alle Geräte); bei frischer Installation kein Hinweis; die Liste bleibt in der Fußzeile, der rote Punkt entfällt
- **GPU-Anleitung** in der Unraid-Vorlage, in der README und unter Einstellungen → Hardware („Wie schalte ich meine GPU frei?“): Intel/AMD brauchen `/dev/dri` (schon eingetragen), NVIDIA zusätzlich `--runtime=nvidia`

**Geändert**
- Beschriftungen im Schritt „Audio & Untertitel“ in Alltagssprache („Was soll mit dem Ton passieren?“, „Unverändert lassen (empfohlen)“, Codec-Namen mit Erklärung, Sprachcodes-Hinweis)
- Weitere Sprachcodes werden erkannt (da, no, fi, cs, hu, el, ar, hi)

**Behoben**
- Info-Text zur Audio-Bitrate nannte für 5.1 fälschlich „2,5×“; tatsächlich Wert × Kanäle ÷ 2 (5.1 = 3×)

## 0.0.9 – 2026-10-16

**Neu**
- **Audio & Untertitel in einem Schritt**: Regeln für alle Dateien (Standard Passthrough) plus **Spurtabelle** je Datei mit Behalten, Aktion (Standard / kopieren / **einzelne Tonspur neu kodieren** mit Codec und kbit/s), **Titel**, **Sprache** (ISO 639-2, wie Plex sie liest), **Forced**, **Standard**; „Alle auswählen/abwählen“, „Auf alle Dateien anwenden“, Warnungen (kein Ton mehr, Forced in MP4). Der Dialog „Spuren“ entfällt, die Dateiliste zeigt nur noch „n Spuren geändert“
- **Alles zurücksetzen** (je Welt, mit Rückfrage): Dateien, Ziel, Benennung und Einstellungen zurück auf „Remux als MKV“ bzw. „Remux als FLAC“; laufende Aufträge bleiben
- **Ziehen zum Aktualisieren** in der Home-Bildschirm-Web-App (wie p5assets)
- **Lesen per VAAPI und NVIDIA nachweisbar**: durchgängige Hardware-Kette (`scale_vaapi`/`scale_cuda`), bei Fehlschlag Ausweichkette (Bilder zurück in den Arbeitsspeicher → CPU); gelingt der erste Weg, zeigt die Warteschlange „Lesen: … ✓“
- „Alle auswählen/abwählen“ auch im Datei-Browser und bei den Vorschlägen der Voreinstellungen
- Erklärzeile unter „Wenn Datei existiert“; Überschreiben in Warnfarbe

**Geändert**
- „Wenn Datei existiert“: verständliche Texte („Beide behalten, neue Datei nummerieren“ …) auch in Zusammenfassung, Hilfe und README
- Voreinstellungen nur noch im Schritt „Video“ bzw. „Einstellungen“ wählbar; Hinweis, dass sie auch Benennen setzen
- **Hardware-Kachel** aufgeräumt (Startseite und Einstellungen): eine Zeile je Hardware, Nutzbares zuerst, „Nicht nutzbar“ eingeklappt, Gründe unter „Warum?“, Plattformfremdes ausgeblendet
- **Intel-Anzeige**: Status „Quick Sync: Leerlauf/aktiv“ statt Prozentzahl, mit Glättung
- „Neuigkeiten“ nur noch in der Fußzeile (mit rotem Punkt bei Neuem)
- **Tab-Icon**: versionierte Icon-Adressen (`?v=<Version>`), `/favicon.ico`, eigene 32/48-px-Tab-Icons, Seite und Icons ohne Zwischenspeicher

**Behoben**
- Farbflackern (kurz Grün) beim Laden: die Weltfarbe wird jetzt vor dem ersten Zeichnen gesetzt

## 0.0.8 – 2026-10-15

**Geändert**
- **App-Icon**: Abzeichen unten rechts sind jetzt **zwei exakt zentrierte Scheiben** – silberne Audio-CD und blaue Blu-ray – statt der zwei Pfeile; alle Größen neu (Favicon, 192/512, Apple-Touch-Icon für die iPhone/iPad-Web-App, Unraid-Icon `unraid/icon.png`)
- Das Icon steht auch in **Einstellungen → Info**, in der **README** und im **Release-Text**
- Icon-Skript `tools/icons/make_icons.py` erzeugt beide Apps (p5converter: Discs, p5assets: oranger Flammen-Komet)

## 0.0.7 – 2026-10-15

**Neu**
- **Log-Seite wie bei p5assets** (Kopfzeile: Terminal-Symbol): Logdatei wählen (aktuelle + rotierte), Stufenfilter (DEBUG/INFO/WARNING/ERROR), Suche, Live-Nachladen, Auto-Scroll, „Ganze Datei laden“, Download, „Leeren“; **Zähler** am Symbol für neue Warnungen/Fehler seit dem letzten Besuch
- **Protokoll** in `/config/logs/p5converter.log` (rotierend, 2 MB × 4; ohne `/config` nur im Speicher): Start und Ordner, Hardware-Erkennung, Aufträge (eingereiht/gestartet/fertig/abgebrochen/Fehler, Ausweichversuche mit ffmpeg-Meldung), Anmeldung, Einstellungen, Umbenennen, Aufräumen; **Passwörter, Sitzungs-Cookies und Tokens werden geschwärzt**
- **App-Icon** im Aufbau von p5assets (Matrix-Regen, Poster-Rahmen, „p5“, etwas kleiner) mit **Abzeichen aus zwei Pfeilen** unten rechts; alle Größen (Favicon, 192/512, Apple-Touch-Icon für iPhone/iPad-Web-App, Unraid-Icon); SVG-Quelle und Erzeugungs-Skript in `tools/icons/`

**Geändert**
- Kopfzeile: Log- und Einstellungen-Knopf nur noch als Symbol (wie bei p5assets)
- Die Konsole schreibt im selben Format wie das Log

## 0.0.6 – 2026-10-15

**Neu**
- **Ablauf in Schritten je Welt** (Variante C: Reiter + Zurück/Weiter): Startseite → Dateien → Ziel → Benennen → Einstellungen → Zusammenfassung; Video: Video-Einstellungen und Audio & Untertitel als eigene Schritte, Audio: ein Schritt „Einstellungen“; ein Schritt pro Bildschirm auf Handy/iPad
- **Startseite**: Statistik, Auslastung, Hardware (Video), **gewonnener Platz**, Warteschlange und die Knöpfe „Konvertierung starten“ und „Umbenennen starten“; nach dem Start geht es automatisch zurück zur Startseite
- **Zusammenfassung** vor dem Start (Dateien, Ziel, Benennen mit Beispielname, Einstellungen, Warnungen, „Ändern“ springt zum Schritt) mit „Als Voreinstellung speichern“ und „Konvertierung starten“
- **Gewonnener Platz**: Summe aus Größe vorher minus nachher aller fertigen Dateien, getrennt für Audio und Video, dauerhaft in `/config/stats.json` (zählt ab diesem Update)

**Geändert**
- „Umbenennen“ wandert aus der Kopfzeile auf die Startseite („Umbenennen starten“)
- Voreinstellungs-Chips stehen als Leiste über den Schritten (nicht auf der Startseite und Zusammenfassung)
- „Dateiname-Zusatz“ gehört jetzt zum Schritt „Benennen“
- UI-Prüfungen (`tools/ui-*.js`) laufen über die Schritte und prüfen alle Ansichten

## 0.0.5 – 2026-10-15

**Neu**
- **Warteschlange je Welt**: Audio und Video haben je eine eigene Warteschlange (eigene Anzahl paralleler Aufträge, Zähler und Fortschrittsring, „Alle abbrechen“/„Fertige entfernen“ nur für die gewählte Welt); Zähler am Welt-Knopf für Aufträge der anderen Welt
- **Farben der Auftragskarten und Kacheln**: grün = geklappt, gelb = Hinweis/Ausweichweg/abgebrochen, rot = Fehler; „Lesen“ bekommt wie „Schreiben“ einen Haken, wenn ffmpeg den Hardware-Decoder bestätigt hat (z. B. `hevc_qsv`)
- **Aufräumen**: beim Abbrechen/Fehler werden `.part`-Datei und vom Auftrag neu angelegte leere Ordner entfernt; `.part`-Reste eines Absturzes werden beim nächsten Start entfernt (`/config/partials.json`, nur selbst angelegte Dateien); Hinweis am „Abbrechen“-Knopf

**Geändert**
- **Auslastungsanzeige** wird dauernd live gemessen (auch im Leerlauf, alle 3 s), Balken gleiten statt zu springen; ohne aktuelle Messung steht „keine Messung“; Intel-Wert heißt ehrlich „Grafik aktiv“ (gesamte Grafik, nicht nur Video)
- **Parallele Aufträge** je Welt in den Einstellungen (Audio/Video)
- Namensmuster, Dateiname-Zusatz und Ersetzungen gelten **je Welt getrennt** (Audio/Video) und gehören zu den Voreinstellungen

**Behoben**
- **„+ Ersetzung“** brachte gelöschte Zeilen wieder zurück (alte Liste im Knopf); Audio und Video teilten sich dieselben Ersetzungen
- Die Auslastung blieb nach einem Auftrag auf dem letzten Wert stehen (CPU 14 %, Videoeinheit 100 % im Leerlauf), weil nur während Aufträgen gemessen wurde

## 0.0.4 – 2026-10-15

**Neu**
- **Umbenennen**: Namensmuster mit Variablen (`{title}`, `{year}`, `{res}`, `{codec}`, `{bit}`, `{container}`, `{date}`, `{filename}` und Audio-Tags) und **Suchen & Ersetzen** (mehrere Regeln, optional Regex und Groß-/Kleinschreibung) im Bereich „Ziel“ – für Audio und Video, mit Live-Vorschau; Muster und Regeln gehören zu den Voreinstellungen
- **Seite „Umbenennen“** (Kopfzeile): Dateien ohne Konvertierung umbenennen, mit Vorschau; überschreibt nie, verschiebt nie, bleibt innerhalb der erlaubten Ordner
- **Quick Sync lesen und schreiben**: Hardware-Decoding mit durchgängiger Hardware-Kette (`vpp_qsv` für Verkleinern/10 Bit); danach zwei weitere Wege (Bilder zurück in den Arbeitsspeicher, CPU liest); Anzeige „Schreiben: Quick Sync · … ✓“ und „Lesen: Hardware/CPU“ getrennt
- Symbole als einfarbige SVGs im Theme (größeres Zahnrad, Stern bei Neuigkeiten, Matrix-Diskette)

**Geändert**
- Standard-Voreinstellungen auf je eine reduziert: „Remux als MKV“ (Video) und „Remux als FLAC“ (Audio)
- „Neu“ in der Kopfzeile heißt jetzt „Neuigkeiten“
- Keine bunten Emojis mehr in der Oberfläche (Ausnahme: die Planeten); „GPU“ durch verständlichere Begriffe ersetzt (Quick Sync steckt in der Intel-CPU)
- Fehlgeschlagene Zwischenversuche (z. B. HW-Decoding) erscheinen nicht mehr als roter Fehler, sondern unter „Details → Frühere Versuche“; ein Fehler wird nur angezeigt, wenn alle Wege scheitern

**Behoben**
- Quick-Sync-Decoding scheiterte bei h265-Quellen mit Verkleinern/10 Bit mit „Function not implemented“ (Software-Filter bekamen GPU-Bilder)
- Die Fehlermeldung des ersten Versuchs blieb beim laufenden zweiten Versuch stehen

**Hinweis (Unraid)**: Zeigt ein bestehender Container noch „Passwort (optional)“ (`P5_PASSWORD`), den Eintrag mit REMOVE löschen – die Variable wird nicht mehr benutzt.

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
