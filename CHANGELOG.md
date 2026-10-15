# Änderungen

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
