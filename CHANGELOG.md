# Änderungen

## 0.3.2 – 2026-10-20

**Neu: Startseite mit zwei Kacheln statt „Welten“**
- Die Startseite fragt **„Was möchtest du umwandeln?“** mit den Kacheln **Video** (grün) und **Audio** (orange). Die Umschaltung in der Kopfzeile, der Weltenübergang, die Seite „Welten & Farben“ und die Einstellung „Startansicht“ sind **weg**; es gibt eine Grundfarbe (p5-Grün), nur der Audio-Bereich ist orange
- **Warteschlange und Verlauf sind eine gemeinsame Liste** mit Abzeichen „Video“/„Audio“; „Alle abbrechen“ gilt für beide, „Parallel“ gibt es je Art. „Gewonnener Platz“ zeigt Video und Audio nebeneinander, getrennt gezählt und getrennt zurücksetzbar. Eine begonnene Auswahl zeigt die Kachel als „weiter“

**Neu: geführter Ablauf für Video in vier Schritten**
- **1 Dateien:** zuerst der **Quellordner** (Knöpfe mit den Anzeigenamen, z. B. „Filme 4K“; der Datei-Browser öffnet gleich dort). Die **Suche durchsucht immer auch alle Unterordner** (ab 2 Zeichen, ohne Haken). Hier stehen auch die Voreinstellungen: wer eine wählt, **springt direkt zur Kontrolle**
- **2 Regeln:** die **voreingestellten Regeln** (siehe unten) mit Haken je Regel und „betrifft N Dateien“, Sprach-Wünsche, Regel-Vorschläge zu den gewählten Dateien („Regel: DTS → E-AC-3“ nur für diesen Lauf oder „Immer anwenden“) und eigene Regeln für diesen Lauf
- **3 Wie umwandeln?:** drei Kacheln **Hardware** (Video-Codec und Encoder als Pillen), **Speichern** (Ort, Struktur, „Wenn die Datei schon da ist“) und **Danach prüfen** (Kästchen mit Erklärung, „Original danach löschen“ rot), darunter die Zusammenfassung als Satz
- **4 Kontrolle & Start:** die Tabelle „Vorher → Nachher“ mit Startleiste. Oben eine **Schrittleiste** (am Handy nur der aktuelle Schritt beschriftet); alle Schritte lassen sich anklicken, die Auswahl bleibt erhalten
- Audio bleibt eine einzige Ansicht (Dateien, Satz, Tabelle), jetzt komplett orange

**Neu: Tabelle in vier Karten**
- **Video** (Video, Container, Qualität), **Audio** (alle Tonspuren, orange), **Untertitel** und **Dateiname** sind eigene Karten mit Symbol, Titel und Kurzfassung („3 Tonspuren · 2 umgewandelt“)
- **Info-Punkte (i)** an Schritten, Karten, Zeilen, Kacheln und Gruppen (Texte in `web/info.js`; neu u. a. Stufen, Funkel-Markierung, Gruppen, Kontrolle)

**Neu: Einstellungen → Regeln**
- Allgemeine Regeln für Ton und Untertitel (z. B. „DTS → E-AC-3, 256 kbit/s je Stereo-Paar“, „Bild-Untertitel entfernen“) mit demselben Editor, **auf dem Server in `/config`**, für alle Geräte. Im Ablauf erscheinen sie als voreingestellte Regeln und lassen sich je Lauf abwählen (die Abwahl wandert mit in Voreinstellungen). Hinweis: die Bitrate gilt je Stereo-Paar, **E-AC-3/AC-3 höchstens 640 kbit/s**; bei 5.1 zeigt die Tabelle „Maximum“ mit Erklärung der Rechnung

**Neu: Codec-Kennung mit Bitrate**
- Spuren heißen jetzt **„Englisch · E-AC-3 (Dolby Digital Plus) 5.1 · 640 kbit/s“** (Kennung zuerst, Markenname in Klammern, bei AAC/FLAC/Opus/MP3 nur einmal; DTS-HD MA/HRA, TrueHD, PGS/VobSub/SRT/ASS sinngemäß). Die Bitrate liest das Programm bei MKV auch aus dem Tag `BPS`, wenn ffprobe sie nicht meldet

**Geändert: Qualität einfacher und sicherer**
- **„Art des Materials“ ist gestrichen.** Es bleiben die vier festen Stufen (x265 auf der CPU: 17 / 20 / 23 / 27) und der Regler unter „Erweitert“; die Abzüge für Anime, Korn und kleine Auflösung entfallen (sie konnten z. B. CRF 14 ergeben und die Datei größer als die Quelle machen). Die Einstellung „Qualität nach Material“ ist entfernt
- **Schutz vor größerem Ergebnis:** wird ein neu kodiertes Video **nicht kleiner** als die Quelle, schlägt die Kontrolle an („Ergebnis ist größer als die Quelle (112 %) …, wähle eine kleinere Stufe“), und das **Original wird nie gelöscht**
- **Hinweis vorher:** ist die Quelle schon klein (unter etwa 4 Mbit/s bei 1080p), steht in der Zeile „Qualität“ ein Hinweis, dass Neukodieren kaum Platz spart

**Geändert**
- Ziel einer umzuwandelnden Tonspur („→ E-AC-3 … 640 kbit/s“) ist **direkt anklickbar**: kleines Fenster für Format und Bitrate, ohne „⋯“
- Regel-Vorschläge nennen jetzt E-AC-3 mit 256 kbit/s je Stereo-Paar (statt AC-3 192)

**Behoben**
- **Standard-Tonspur:** eine zweite Spur ließ sich als Standard markieren, aber nicht wieder abwählen (beide zeigten „Standard“). Jetzt gibt es höchstens eine; ein Klick auf eine andere setzt sie und nimmt allen übrigen den Standard (auch dem aus der Quelldatei oder der Rangliste), ein Klick auf die gesetzte nimmt die eigene Wahl zurück

**Intern**
- Neu: `trackRules` in den Einstellungen (mit Prüfung und Tests), Verlauf `kind=all`, `checkBigger` in der Kontrolle, `web/planets.js` entfernt; neue UI-Prüfung `tools/ui-check-rules.js`; die UI-Prüfungen laufen durch die vier Schritte

## 0.3.1 – 2026-10-19

**Neu: Suche im Datei-Browser** („+ Dateien“, „+ Ordner“, Zielordner)
- **Suchfeld** im Fenster: ohne Haken filtert es beim Tippen die Einträge des aktuellen Ordners („3 von 12“); „Alle auswählen“ gilt dann nur für die Treffer
- **„Auch in Unterordnern“:** sucht ab 2 Zeichen im ganzen Ordner darunter (in der Liste der Quellordner in allen), zeigt den Pfad der Treffer, Dateien lassen sich direkt abhaken und hinzufügen, ein Ordner öffnet sich per Klick. Beim Wählen von Ordnern werden nur Ordner gefunden. Höchstens 300 Treffer, versteckte Ordner werden übersprungen
- Groß/Klein ist egal, **Umlaute dürfen so oder so getippt werden** („muller“ und „mueller“ finden „Müller“)

**Neu: Anzeigenamen für Quellordner** (Einstellungen → Allgemein → „Namen der Quellordner“)
- Statt `/video1` steht im Datei-Browser z. B. **„Filme 4K“** (der echte Pfad bleibt als kleiner Zusatz und im Pfadfeld); „Angezeigt als: …“ zeigt den Namen auch in Unterordnern, der Satz „gespeichert …“ nutzt ihn für den Zielordner. Das Template muss dafür nicht geändert werden

**Geändert**
- Im Datei-Browser führt „hoch“ in einem Quellordner jetzt zur Liste aller Quellordner (vorher war der Knopf dort gesperrt)

**Intern**
- Neu: `/api/fs/search` (`internal/server/fssearch.go`, mit Tests), `rootNames` in den Einstellungen (mit Test); neue UI-Prüfung `tools/ui-check-browser.js`

## 0.3.0 – 2026-10-19

**Neu: eine Ansicht statt sechs Schritte („Konvertieren“)**
- **Oben die Dateien, darunter ein Satz zum Antippen, darunter die Tabelle „Vorher → Nachher“.** Links steht, wie die Datei jetzt ist (Video, Container, Bitrate, jede Tonspur, jeder Untertitel, Dateiname), rechts, was nach dem Umwandeln herauskommt; jede Zeile lässt sich direkt ändern (Auswahl, Standard, Forced, „⋯“ für Titel, Sprache, Format und Bitrate). Geändertes ist farbig, entfernte Spuren sind durchgestrichen
- **Der Satz** („Die Dateien werden mit [Hardware] umgewandelt, gespeichert [neben der Quelle] und danach geprüft: [Spuren und Decode-Test]“) öffnet bei Antippen kleine Fenster für Hardware, Ziel (inkl. „Wenn Datei existiert“) und Prüfen; am Handy erscheinen sie als Blatt unten
- **Gruppen nach Rahmendaten:** Dateien mit gleichem Aufbau (Video, Spuren, Sprachen, Formate, Kanäle) bilden eine Gruppe, eine Entscheidung gilt für alle. Abweichende Dateien bilden eine **eigene Gruppe, die kontrolliert werden muss** („noch nicht kontrolliert“, Knopf „✓ Gruppe ist kontrolliert“, Rückfrage beim Start). Ist eine Gruppe kontrolliert, **übernimmt das Programm ihre Entscheidungen bei gleichen Spuren** der anderen Gruppen (als „Übernommen“ markiert)
- **Funkel-Markierung nur für Automatisches** (Regeln, Sprach-Wünsche, Forced-Erkennung, Übernahme): mit Begründung und „rückgängig“ bzw. „Als Forced markieren“ bei reinen Vorschlägen; Standardvorschläge leuchten nicht
- **Details** (Knopf unten): Ziel & Name, Video (bzw. Audio-Einstellungen), Audio & Untertitel (Regeln, Sprach-Wünsche, Einzelspuren), Prüfen & Original – die früheren Schritte als Reiter eines seitlichen Blattes. Voreinstellungen stehen oben, „Als Voreinstellung speichern“ und „Zurücksetzen“ in der Startleiste, die zusammenfasst, was passiert
- Audio-Welt: dieselbe Ansicht mit den Zeilen Format, Qualität/Bitrate, Samplerate, Kanäle, Cover, Dateiname

**Neu: Qualität in Stufen statt einer CRF-Zahl**
- **Sehr gut / Gut (empfohlen) / Normal / Klein**; das Programm rechnet je Encoder (CPU, Intel Quick Sync, NVIDIA, VAAPI, AMD) und Codec in die passende Zahl um, denn dieselbe Zahl bedeutet bei CRF, CQ, ICQ und QP nicht dasselbe (Quick Sync liegt bei gleicher Zahl deutlich kleiner als NVENC). Die Stufe bleibt beim Encoder-Wechsel, die Zahl passt sich an
- **Erweitert** zeigt den Regler mit der echten Zahl und dem Namen (CRF, CQ, ICQ, QP); bewegt man ihn, steht „Eigener Wert“. Art des Materials (Anime −4, Korn −2) und 720p oder kleiner (−1) verschieben alle Stufen. Bei Bereichen aus Anleitungen gilt der niedrigere Wert. **Die Zahlen sind Startwerte, nicht auf echter Hardware gemessen**
- Voreinstellungen speichern die Stufe (`vQuality`); ältere Voreinstellungen und gespeicherte Werte werden zur passenden Stufe

**Geändert**
- Die Schritt-Reiter und „Zurück/Weiter“ entfallen; die Konvertieren-Ansicht ist über die Kopfzeile erreichbar. Das Fenster „Details“ schließt, wenn man zu einer anderen Seite (z. B. Einstellungen) wechselt
- Handy: Kopfzeile scrollt in der Konvertieren-Ansicht mit weg, Startleiste kompakter („Starten“, Symbole)
- Suchfelder (Verlauf, Logs) sind im Theme gestaltet

**Intern**
- Neu: `web/convert.js` (Ansicht), `web/quality.js` (Stufen, mit Node getestet: `tools/test-quality.js`, auch in CI und `precheck.sh`); `web/trkplan.js` um Rahmendaten-Schlüssel, Übernahme und Gründe für die Markierung erweitert (31 Tests)
- Neue UI-Prüfung `tools/ui-check-convert.js` (Gruppen, Kontrolle, Übernahme, Markierung, echter Lauf); `ui-check`, `-forced`, `-verify`, `-home`, `-tracks`, `-settings`, `-world`, `-encoder` an die neue Ansicht angepasst; 60 Dateien: Tabelle nach etwa 1,3 s, Änderungen unter 100 ms

## 0.2.0 – 2026-10-18

**Neu**
- **Forced-Untertitel nach Größe erkennen:** Ist ein Untertitel in derselben Sprache viel kleiner als die vollständige Spur (unter 20 %, z. B. „38 statt 1.240 Zeilen“), schlägt das Programm „Als Forced markieren“ vor (Hinweis mit Begründung und Schild „Forced?“). Gelesen werden die Größenangaben, die mkvmerge in MKV-Dateien ablegt; fehlen sie, bleibt es beim Hinweis nach dem Titel. Es wird **nie still gesetzt**; nur wenn in den Sprach-Wünschen „Deutsch (Forced)“ als Standard-Untertitel steht, ist der erkannte Untertitel gleich vorausgewählt (in der Vorschau „Was passiert“ sichtbar, änderbar)
- README: Hinweis auf [ULDAS](https://github.com/netplexflix/ULDAS) für Spuren ohne Sprachangabe

**Schneller**
- **Weboberfläche:** Dateien kommen mit ETag (unveränderte nur noch als „304“) und gzip (Skripte und Styles etwa 65 % kleiner)
- **`/api/state` (jede Sekunde abgefragt):** beendete Aufträge tragen kein Log/Befehl mehr (steht im Verlauf), höchstens 500 beendete Aufträge im Speicher; ein Zähler „beendet“ löst das Neuladen des Verlaufs aus. Bei großen Staffeln bleibt die Oberfläche flüssig
- Beim Start werden die Dateien höchstens 6 gleichzeitig gelesen (statt alle auf einmal); ein Reiter im Hintergrund fragt nur alle 5 Sekunden ab

**Design**
- Kopfzeile am Handy kompakter (etwa 15 px niedriger)

**Tests**
- Neu: Go-Tests für Auftragsliste (Strippen, Begrenzen, Zähler), ETag/gzip, Größenangaben der Untertitel; 6 weitere Fälle in `test-trkplan.js` (Forced erraten, Vorauswahl, eigene Entscheidung gewinnt)

## 0.1.7 – 2026-10-18

**Geändert: Startseite aufgeräumt**
- **Kopfzeile:** „Konvertieren“, „Umbenennen“ und „Verlauf“ sitzen jetzt dort und gelten in jeder Ansicht (am Handy als eigene Zeile unter den Welten); am Verlauf-Knopf zeigt ein Zähler die laufenden und wartenden Aufträge
- **Start und Schritte 1–6 sind auf der Startseite ausgeblendet** und erscheinen erst, wenn man den Assistenten startet
- **Oben auf der Startseite statt des Kreises mit den Zahlen: der aktuelle Auftrag** („Datei 4 von 13“, Dateiname, Fortschrittsbalken, Speed/fps/Restzeit, Schreiben/Lesen mit den grünen Haken, bei mehr als einem Auftrag zusätzlich „Gesamt“); bei parallelen Aufträgen nur die gerade aktuelle Datei. Ohne Auftrag steht dort „Gerade nichts los“; die Live-Auslastung bleibt daneben
- **Hardware** und **Gewonnener Platz** sind gleich groß
- **Die Warteschlange ist in den Verlauf umgezogen** (Seite „Verlauf“: oben laufende und wartende Aufträge mit „Parallel“ und „Alle abbrechen“, darunter die beendeten). Beendete Aufträge verlassen die Warteschlange sofort und stehen im Verlauf; „Fertige entfernen“ entfällt. Der Verlauf zeigt jetzt auch die Bestätigung (✓) für Hardware-Schreiben und -Lesen

## 0.1.6 – 2026-10-18

**Neu: „Audio & Untertitel“ neu gebaut (Videowelt)**
- **Gruppen statt Einzeldateien:** alle Dateien werden nach ihren **Sprachen** zusammengefasst (z. B. „22 Folgen: Deutsch, Englisch, Untertitel Deutsch/Englisch“ und „2 Folgen: nur Englisch“). Je Gruppe stehen die Sprachen als Haken (gilt für die ganze Gruppe), eine Vorschau „Was passiert“ (Beispiel-Datei) und die Dateiliste. Abweichende Gruppen sind markiert. Oben steht die Gesamtwirkung („12 Spuren entfernt, 5 umgewandelt …“)
- **Umschalter Gruppen / Tabelle / Einzelne Dateien:** die **Tabelle** zeigt alle Dateien als Zeilen und alle Sprachen als Spalten mit Haken (Spaltenhaken gilt für alle Dateien); „Einzelne Dateien“ sind die bisherigen Spurkarten
- **Regeln nach Format** (Ton und Untertitel): z. B. „nur DTS → umwandeln in AC-3 192 kbit/s je Stereo-Paar, alles andere unverändert“, auch nach Kanälen (Surround/Stereo), „entfernen“ und für Untertitel „Bild-Untertitel (PGS/VobSub) entfernen“. Die erste passende Regel gewinnt, eigene Änderungen gehen vor. Das Programm **schlägt Regeln vor**, wenn es passende Spuren findet (DTS, TrueHD, Bild-Untertitel). Die Regeln sind als **Voreinstellung speicherbar**
- **Sprach-Wünsche** (Einstellungen → Audio & Untertitel): Rangliste wie bei p5assets (Ziehgriff, ▲ ▼, ✕, „Sprache hinzufügen“) für: Ton behalten, Standard-Ton („Deutsch, sonst Englisch“), Untertitel behalten, Standard-Untertitel (z. B. „Deutsch (Forced)“ zuerst). Das Programm setzt das im Schritt automatisch (abschaltbar, jede Spur änderbar); die Tipps berücksichtigen es. Hat eine Datei keine der gewünschten Sprachen, wird nichts entfernt (Hinweis)
- „Nur diese Sprachen behalten“ am Anfang des Schritts entfällt (steckt in den Sprach-Wünschen); die Wirkung steht auch in der Zusammenfassung
- Beschriftung: „Forced (erzwungene Untertitel)“ statt „Nur bei fremdsprachigen Stellen zeigen (Forced)“

**Behoben**
- **Bevorzugter Encoder** (Einstellungen → Hardware) wirkte nur beim allerersten Besuch: „Automatisch“ nimmt jetzt den bevorzugten Encoder, wenn er für den Codec nutzbar ist (Auswahl heißt dann „Automatisch (bevorzugt: Intel Quick Sync)“); eine bewusst gewählte Hardware im Assistenten gilt immer. Auch „Zurücksetzen“ stellt nicht mehr auf „schnellste verfügbare“ zurück
- „Wird verwendet“ zeigt den Encoder zusammen mit dem Hardware-Namen (z. B. `hevc_qsv` · Intel Quick Sync)

**Intern**
- `web/trkplan.js`: die Berechnung (Regeln, Wünsche, Standard-Spur, Gruppen) ist reine Logik und wird mit `tools/test-trkplan.js` getestet (auch in der CI); neue UI-Prüfung `tools/ui-check-trkgroups.js`
## 0.1.5 – 2026-10-17

**Neu**
- **Verlauf der Konvertierungen** (Startseite → „Verlauf“, Adresse `#history`): die letzten **100** beendeten Aufträge je Welt (Audio und Video getrennt), gespeichert in `/config` (`history.json`), bleibt nach „Fertige entfernen“ und nach einem Neustart erhalten. Je Eintrag: Datum, Dateiname, Ergebnis (fertig, Fehler, abgebrochen, übersprungen), Größe vorher/nachher, Dauer; aufklappbar mit Quelle, Ziel, Encoder, Prüfergebnis, Warnungen und bei Fehlern ffmpeg-Befehl und Log. Suche, Filter nach Ergebnis und Zeitraum, **CSV-Export** (für Excel), „Verlauf leeren“ (mit Rückfrage, nur die gewählte Welt). Ohne beschreibbares `/config` bleibt der Verlauf nur im Arbeitsspeicher (Hinweis auf der Seite)

**Geändert**
- **Schonfrist („Papierkorb“) für Quelldateien wieder entfernt** (aus 0.1.4): „Quelldatei löschen“ löscht nach bestandener Prüfung sofort und endgültig. Die Prüfungen A (Spuren & Größe) und B (Decode-Test) bleiben
- **Ersetzen (Benennen und Umbenennen): „Regex“ und „Aa“ entfernt**: gesucht wird genau der eingegebene Text (Sonderzeichen wie `[` oder `(` sind normale Zeichen), Groß-/Kleinschreibung ist egal. Gespeicherte Regeln mit den alten Feldern werden weiter geladen, die Felder werden ignoriert

## 0.1.4 – 2026-10-17

**Neu**
- **Kontrolle der fertigen Datei, bevor das Original gelöscht wird** (Zusammenfassung → „Ergebnis prüfen & Original“, je Welt getrennt, Standardauswahl in Einstellungen → Allgemein):
  - Immer: die neue Datei muss lesbar sein und (fast) die gleiche Laufzeit haben (wie bisher, jetzt auch ohne „Quelldatei löschen“)
  - **A – Spuren & Größe** (standardmäßig an): alle gewählten Video-/Audio-/Untertitelspuren sind im Ergebnis, die Datei ist nicht absurd klein
  - **B – Decode-Test** (standardmäßig an): ffmpeg liest das ganze Ergebnis einmal durch und meldet beschädigte Stellen; die Warteschlange zeigt dabei „prüfe Ergebnis …“
  - **C – Schonfrist** (nur mit „Quelldatei löschen“, sonst ausgegraut): das Original wird nicht sofort gelöscht, sondern in den Ordner „p5converter-gelöscht“ neben der Quelle verschoben und nach 1–90 Tagen (einstellbar, Standard 7) endgültig entfernt (stündlich geprüft, auch nach einem Neustart)
  - Neben jeder Kontrolle steht in Worten, wie viel länger es dauert („kaum länger“, „etwas länger“, „viel länger“, Schätzwerte)
  - Fällt eine Prüfung durch, bleibt das Original liegen und der Auftrag zeigt eine Warnung; bestandene Prüfungen stehen als „✓ geprüft“ am Auftrag
- **Automatischer CRF-Vorschlag** im Video-Schritt: Auswahl „Art des Materials“ (Standard, aktueller Film, altes Material mit Korn, Anime, Zeichentrick, Heimvideo); der Regler wird mit einem Startwert vorausgefüllt, mit kurzer Begründung und „Empfehlung setzen“. Werte aus Anleitungen und Foren (bei Bereichen der niedrigere Wert): x265 20, x264 18, AV1 24; Anime/Zeichentrick −4, Material mit Korn −2, 720p und kleiner −1. Abschaltbar in Einstellungen → Allgemein
- `tools/precheck.sh`: Vorprüfung vor jedem Push (gofmt, vet, Windows-Build, go.mod, JS-Syntax, eingebettete Dateien, Versionsstellen, YAML, Tests)

**Geändert**
- „Quelldatei löschen“ steht jetzt im letzten Schritt (Zusammenfassung) und wird bewusst **nicht mehr gemerkt**: bei jedem Besuch aus, je Welt getrennt
- CI: ein neuer Push auf denselben Pull Request bricht den veralteten Lauf ab

## 0.1.3 – 2026-10-16

**Behoben (Windows-App, nur `dev`)**
- **Hardware wurde nicht angezeigt, beim Start erschien „Start fehlgeschlagen: Cannot read properties of null (reading 'find')“**: Das App-Fenster fragt schon, bevor die Hardware-Erkennung fertig ist (Windows: ca. 3 s); der Server lieferte dann `null` statt leerer Listen und die Oberfläche brach ab. Jetzt liefert der Server immer leere Listen, die Oberfläche kommt auch mit unvollständigen Antworten zurecht und zeigt „Erkennung läuft …“
- **„Beenden“ erschien erst sehr spät**: Der Knopf und die Fußzeile erscheinen jetzt sofort beim Start, unabhängig von der Hardware-Erkennung
- **NVIDIA: ältere ffmpeg-Version** (6.1.1 von gyan.dev, dieselbe Reihe wie im getesteten Docker-Image) statt der neuesten (9.0): sie braucht nur die NVENC-Schnittstelle 12.1 (Treiber ab ca. 531) statt 13.1 und läuft mit viel mehr NVIDIA-Treibern
- **Verständliche Meldung, wenn der NVIDIA-Treiber zu alt ist** („Dein NVIDIA-Treiber ist zu alt für NVENC: er kann NVENC 12.0, dieses ffmpeg braucht … Bitte den Treiber aktualisieren“) und wenn keine NVIDIA-Grafik/kein Treiber da ist, statt der rohen ffmpeg-Zeilen

**Neu**
- Fehler der Oberfläche werden ins Protokoll des Programms geschrieben („Fehler in der Oberfläche: …“), damit sie auch ohne Entwicklerwerkzeuge sichtbar sind
- Tests: UI-Prüfung mit unvollständiger Hardware-Antwort (hätte den Fehler gefunden), Go-Tests für leere Listen und die NVIDIA-Meldung; der GUI-Test in der CI verzögert die Erkennung künstlich und prüft, dass kein Fehler auftritt

## 0.1.2 – 2026-10-16

**Neu (nur Branch `dev`)**
- **Windows: Symbol im Infobereich (Tray)** mit „p5converter öffnen“ und „Beenden“ (Rückfrage, wenn noch Aufträge laufen); Klick auf das Symbol zeigt das Fenster
- **Das Schließen-Kreuz versteckt nur das Fenster**: p5converter und laufende Aufträge laufen im Infobereich weiter; ein zweiter Start oder das Symbol holt das Fenster zurück; beendet wird über das Symbol oder den Knopf „Beenden“ in der Oberfläche
- **GUI-Test in der CI unter echtem Windows**: startet die App mit Fenster, prüft über die WebView2-Schnittstelle, dass die Oberfläche geladen ist (inkl. Bild als Artefakt `gui-test`), dass Schließen nur versteckt und dass der zweite Start das Fenster zurückholt
- Bei einer Versions-Vorabversion vom Branch `dev` (z. B. `v0.2.0-dev`) hängt die CI die `p5converter-setup.exe` als Anhang an; sonst liegt sie immer in der laufenden Vorabversion `dev-latest`

## 0.1.1 – 2026-10-16

**Neu (nur Branch `dev`)**
- **Windows-App** (Variante B): `p5converter-setup.exe` – **eine einzige Datei** mit Programm, ffmpeg und Installer; die Weboberfläche läuft in einem **eigenen App-Fenster** (Microsoft Edge WebView2, gleiches Aussehen wie im Browser), eigenes Programmsymbol, Installation nur für den Benutzer ohne Administrator-Abfrage (Startmenü, optional Desktop-Symbol und Autostart), die WebView2-Komponente wird nur bei Fehlen nachinstalliert
- Hardware wird automatisch erkannt (Intel Quick Sync, NVIDIA NVENC, AMD AMF per echtem Test-Encode; für Quick Sync zusätzliche Windows-Startvarianten über Direct3D 11/DXVA2)
- Links nach außen (z. B. GitHub) öffnen im Standardbrowser; ein zweiter Start holt das vorhandene Fenster nach vorn; beim Beenden werden laufende ffmpeg-Prozesse mit beendet
- Die CI baut den Installer auf Windows, testet Server, Hardware-Erkennung und Laufwerksliste unter echtem Windows sowie Installation und Deinstallation und veröffentlicht die Datei als laufende Vorabversion **`dev-latest`** (nur vom Branch `dev`)
- Einstellungen → Hardware: Hilfetext für Windows

**Geändert**
- Hilfsprogramme (ffmpeg, ffprobe, …) starten unter Windows ohne aufblitzendes Konsolenfenster

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
