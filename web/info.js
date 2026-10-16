'use strict';
// Anfänger-Erklärungen für jede Einstellung. Schlüssel = id des Bedienelements (oder data-info).
const INFO = {
  outMode: {t: 'Speicherort', b: `<p>Wohin die fertige Datei geschrieben wird.</p>
    <ul><li><b>Neben der Quelldatei:</b> Die neue Datei liegt im selben Ordner wie das Original. Praktisch für ein paar Dateien.</li>
    <li><b>Eigener Ordner:</b> Alles landet in einem Ordner deiner Wahl, z. B. <code>/output</code>. Besser bei großen Sammlungen – dein Original-Ordner bleibt sauber.</li></ul>
    <p class="ex">Das Original wird nie verändert (außer du aktivierst „Quelldatei löschen“).</p>`},
  outDir: {t: 'Zielordner', b: `<p>Der Ordner, in den die Ergebnisse geschrieben werden. Mit <b>…</b> kannst du ihn auf dem Server/Rechner aussuchen. Fehlt er, wird er angelegt.</p>`},
  outStruct: {t: 'Struktur', b: `<p>Nur relevant, wenn du ganze Ordner hinzugefügt hast.</p>
    <ul><li><b>Ordnerstruktur beibehalten:</b> Aus <code>Serien/Staffel1/Folge1.mkv</code> wird <code>Ziel/Serien/Staffel1/Folge1.mkv</code>.</li>
    <li><b>Alles in einen Ordner:</b> Alle Dateien landen direkt im Zielordner. Achtung: gleiche Dateinamen werden dann umbenannt/überschrieben (siehe „Wenn Datei existiert“).</li></ul>`},
  suffix: {t: 'Dateiname-Zusatz', b: `<p>Text, der an den Dateinamen vor der Endung angehängt wird. Hilft, Original und Kopie zu unterscheiden.</p>
    <p class="ex">Beispiel: Zusatz <code>_x265</code> → aus <code>Film.mkv</code> wird <code>Film_x265.mkv</code>.</p>
    <p>Leer lassen ist ok: Haben Quelle und Ziel denselben Namen, hängt das Programm automatisch „(konvertiert)“ an, damit nichts überschrieben wird.</p>`},
  pattern: {t: 'Namensmuster', b: `<p>Legt fest, wie die neue Datei heißt – aus Variablen wie Titel, Jahr, Auflösung oder Codec. Leer = Originalname. Klicke unter dem Feld auf eine Variable, um sie einzufügen.</p>
    <p class="ex">Video: <code>{title} ({year}) [{res}][{codec}]</code><br>→ <code>Der Flug (2023) [720p][x265].mkv</code></p>
    <p class="ex">Audio: <code>{artist}/{album}/{track} - {title}</code><br>→ <code>Die Ärzte/Jazz ist anders/03 - Lied.mp3</code> (mit <code>/</code> entstehen Ordner)</p>
    <p><code>{res}</code>, <code>{codec}</code> und <code>{bit}</code> zeigen den <b>Zielwert</b> deiner Einstellungen (z. B. 720p, x265, 10bit); bei „Remux/kopieren“ den Wert der Quelle. Fehlt ein Tag, steht „Unbekannt“ (beim Titel der Dateiname).</p>`},
  renReplace: {t: 'Suchen und Ersetzen', b: `<p>Ändert Teile des Dateinamens, nachdem das Muster angewendet wurde – wie in einem Texteditor. Mehrere Ersetzungen laufen von oben nach unten.</p>
    <p class="ex">Suchen <code>WEBDL</code>, Ersetzen durch <code>WEB</code> → aus <code>Film [WEBDL-1080p]</code> wird <code>Film [WEB-1080p]</code>. „Ersetzen durch“ leer = Text löschen.</p>
    <ul><li><b>Aa</b>: Groß-/Kleinschreibung beachten (sonst egal).</li>
    <li><b>Regex</b> (für Fortgeschrittene): Suchtext ist ein regulärer Ausdruck, <code>$1</code> steht für die erste Klammer. Beispiel: <code>\[(\w+)-(\d+p)\]</code> → <code>$2 $1</code>.</li></ul>
    <p>Die Vorschau zeigt sofort das Ergebnis; Endung und Ordner bleiben unberührt.</p>`},
  exists: {t: 'Wenn Datei existiert', b: `<p>Was passieren soll, wenn es die Zieldatei schon gibt.</p>
    <ul><li><b>Beide behalten, neue Datei nummerieren:</b> Die vorhandene Datei bleibt, die neue bekommt eine Nummer, z. B. <code>Film (2).mkv</code>. Nichts geht verloren – die sicherste Wahl.</li>
    <li><b>Überspringen, vorhandene Datei nicht anfassen:</b> Die Datei wird nicht erneut umgewandelt. Gut, wenn du einen Ordner nach einem Abbruch noch einmal startest.</li>
    <li><b>Überschreiben, vorhandene Datei ersetzen:</b> Die alte Zieldatei wird durch die neue ersetzt. Das lässt sich nicht rückgängig machen.</li></ul>`},
  deleteSource: {t: 'Quelldatei löschen', b: `<p>Löscht das Original, <b>nachdem</b> die neue Datei erfolgreich fertig ist. Das ist <b>endgültig</b> (kein Papierkorb).</p>
    <p>Empfehlung für Anfänger: aus lassen, erst Ergebnis ansehen/anhören, dann selbst aufräumen.</p>`},

  aFormat: {t: 'Audio-Format', b: `<ul><li><b>MP3:</b> läuft überall (Auto, Handy, alte Geräte). Sicherste Wahl.</li>
    <li><b>Opus:</b> bei kleiner Bitrate die beste Qualität, ideal für Sprache/Podcasts. Nicht jedes ältere Gerät kann es.</li>
    <li><b>AAC (M4A):</b> Standard bei Apple/iTunes, gute Qualität.</li>
    <li><b>Ogg Vorbis:</b> freies Format, gute Qualität, auf Handys seltener unterstützt.</li>
    <li><b>FLAC:</b> verlustfrei – klingt wie das Original, Dateien ca. halb so groß wie WAV. Zum Archivieren von CDs.</li>
    <li><b>WAV:</b> unkomprimiert, riesig. Nur für Audio-Bearbeitung.</li></ul>
    <p class="ex">Wichtig: Aus einer MP3 wieder eine MP3/FLAC zu machen verbessert die Qualität <b>nicht</b> – jede verlustbehaftete Umwandlung (MP3, AAC, Opus, Ogg) verschlechtert sie etwas. Wenn möglich von FLAC/WAV/CD ausgehen.</p>`},
  aMode: {t: 'Qualitätsmodus', b: `<ul><li><b>Variable Bitrate (VBR):</b> Das Programm nimmt mehr Daten für schwierige Stellen, weniger für einfache. Bei gleicher Größe meist bessere Qualität. <b>Empfohlen.</b></li>
    <li><b>Konstante Bitrate (CBR):</b> Immer gleich viele kbit/s. Nur nötig, wenn ein altes Gerät oder Streaming es verlangt – oder du die Dateigröße genau planen willst.</li></ul>`},
  aQuality: {t: 'Qualität (VBR)', b: `<p>Regler für die Qualität. Bei MP3 gilt „V“-Stufen: <b>kleiner = besser</b>.</p>
    <ul><li>V0 ≈ 245 kbit/s – sehr hoch</li><li><b>V2 ≈ 190 kbit/s – sehr gut, guter Standard</b></li><li>V4 ≈ 165 kbit/s – gut</li><li>V6 ≈ 115 kbit/s – ok für Hörbücher/Unterwegs</li></ul>
    <p>Bei Ogg Vorbis ist es umgekehrt (0–10, <b>größer = besser</b>, ca. 5 ≈ 160 kbit/s).</p>`},
  aBitrate: {t: 'Bitrate', b: `<p>Wie viele Daten pro Sekunde für den Ton benutzt werden. Mehr = besser, aber größere Datei.</p>
    <ul><li>96–128 kbit/s: Sprache, Podcasts, Hörbücher</li><li><b>192 kbit/s: gute Musik-Qualität</b></li><li>256–320 kbit/s: höchste Qualität (MP3 max. 320)</li></ul>
    <p class="ex">Ein 4-Minuten-Lied hat bei 192 kbit/s etwa 5,5 MB, bei 320 kbit/s etwa 9 MB. Opus klingt schon bei 96–128 kbit/s sehr gut.</p>`},
  aFlac: {t: 'FLAC-Kompression', b: `<p>0 = schnell, Datei etwas größer · 8 = langsamer, Datei etwas kleiner.</p>
    <p><b>Die Klangqualität ist immer identisch</b> (verlustfrei) – es ändert sich nur Zeit und Dateigröße. 5 ist ein guter Standard.</p>`},
  aWav: {t: 'WAV Bit-Tiefe', b: `<ul><li><b>16 Bit:</b> wie eine Audio-CD. Reicht für alles zum Hören.</li><li><b>24 Bit:</b> für Studio/Bearbeitung, Dateien 50 % größer.</li><li>32 Bit: nur für Spezialfälle.</li></ul>
    <p>Eine 16-Bit-Quelle auf 24 Bit zu stellen bringt keine bessere Qualität.</p>`},
  aRate: {t: 'Samplerate', b: `<p>Wie oft pro Sekunde der Ton gemessen wird.</p>
    <ul><li><b>Wie Quelle:</b> nichts ändern – <b>meist richtig</b>.</li><li>44,1 kHz: Audio-CD/Musik</li><li>48 kHz: Ton von Videos/Filmen</li></ul>
    <p>Nur ändern, wenn ein Gerät es verlangt. Höher stellen verbessert nichts.</p>
    <p class="ex">Opus unterstützt kein 44,1 kHz – dort wird automatisch 48 kHz verwendet.</p>`},
  aCh: {t: 'Kanäle', b: `<ul><li><b>Wie Quelle:</b> unverändert (meist richtig).</li><li><b>Mono:</b> ein Kanal – halbiert ungefähr die Größe. Gut für Sprache/Podcasts/Hörbücher, schlecht für Musik.</li><li><b>Stereo:</b> links/rechts. Wandelt z. B. 5.1-Surround in Stereo um.</li></ul>`},
  aCover: {t: 'Cover-Bild', b: `<p>Übernimmt das eingebettete Albumcover in die neue Datei (bei MP3, M4A und FLAC). Titel, Interpret, Album usw. werden immer übernommen.</p>`},

  vContainer: {t: 'Container (Dateityp)', b: `<p>Der „Karton“, in dem Bild, Ton und Untertitel liegen. Hat nichts mit der Bildqualität zu tun.</p>
    <ul><li><b>MKV:</b> kann alles aufnehmen (viele Tonspuren, alle Untertitel-Arten, Kapitel). <b>Empfohlen</b> für Plex/Jellyfin/Kodi/PC.</li>
    <li><b>MP4:</b> läuft auf den meisten Smart-TVs, Handys, Apple-Geräten. Aber: Bild-Untertitel (z. B. von Blu-rays/PGS) passen nicht hinein und werden entfernt, Text-Untertitel werden umgewandelt.</li></ul>`},
  vCodec: {t: 'Video-Codec', b: `<p>Die Methode, mit der das Bild komprimiert wird. Neuere Methode = kleinere Datei bei gleicher Qualität, aber langsamer und nicht überall abspielbar.</p>
    <ul><li><b>Kopieren:</b> Bild bleibt unverändert, nichts wird neu berechnet – sehr schnell, kein Qualitätsverlust. Gut, um nur in MKV zu verpacken oder Spuren zu entfernen.</li>
    <li><b>H.264:</b> läuft auf wirklich jedem Gerät. Größte Dateien der Auswahl.</li>
    <li><b>H.265 (HEVC):</b> ca. 30–50 % kleiner als H.264 bei gleicher Qualität. Läuft auf fast allen Geräten ab ca. 2016. <b>Guter Allround-Tipp.</b></li>
    <li><b>AV1:</b> noch etwas kleiner, aber auf der CPU sehr langsam; nur neue Geräte spielen es flüssig ab. Eher für Archiv und Zukunft.</li>
    <li><b>VP9:</b> ähnlich HEVC, vor allem im Web (YouTube) verbreitet.</li></ul>
    <p class="ex">Beispiel: 8 GB Film in H.264 → ca. 4–5 GB in H.265, ohne sichtbaren Unterschied.</p>`},
  vBackend: {t: 'Encoder / Hardware', b: `<p>Wer die Rechenarbeit macht.</p>
    <ul><li><b>CPU (Software):</b> beste Qualität pro Dateigröße, aber langsam und belastet den Prozessor stark. Gut für Archiv und Dinge, die du nur einmal machst.</li>
    <li><b>Hardware (Intel Quick Sync – ein Teil der Intel-CPU –, NVIDIA NVENC, AMD AMF, VAAPI):</b> oft 5–20× schneller und schont die CPU. Bei gleicher Qualität werden die Dateien aber meist etwas größer.</li></ul>
    <p><b>Automatisch</b> nimmt die schnellste Hardware, die wirklich funktioniert. Nur Einträge mit ✓ lassen sich nutzen – das Programm testet das beim Start mit einem echten Mini-Encode.</p>
    <p class="ex">Tipp: Ganze Bibliothek schnell verkleinern → Hardware. Lieblingsfilm in bester Qualität archivieren → CPU.</p>`},
  vResolved: {t: 'Wird verwendet', b: `<p>Zeigt den Encoder, den das Programm mit deinen Einstellungen einsetzt, z. B. <code>hevc_qsv</code> (Intel Quick Sync) oder <code>libx265</code> (CPU).</p>
    <p>Beim laufenden Auftrag zeigt die Warteschlange zwei getrennte Angaben: <b>Schreiben</b> (Encoder, z. B. „Quick Sync · hevc_qsv ✓“ – das Häkchen heißt: ffmpeg hat die Nutzung bestätigt) und <b>Lesen</b> (Decoder: Hardware oder CPU).</p>`},
  vCrf: {t: 'Qualität (CRF)', b: `<p>Der wichtigste Regler: bestimmt Bildqualität und Dateigröße. <b>Kleinerer Wert = bessere Qualität, größere Datei.</b></p>
    <ul><li>H.264: 18 (sehr hoch) – <b>21–23 (gut)</b> – 28 (sichtbar schlechter)</li>
    <li>H.265: 20 – <b>23–26</b> – 30</li>
    <li>AV1: 24 – <b>28–32</b> – 38</li></ul>
    <p><b>Faustregel:</b> alle ca. +6 halbiert etwa die Dateigröße.</p>
    <p>Bei Grafikchips ist der Wert ein ähnlicher „Qualitätswert“, aber nicht 1:1 vergleichbar (ca. 20–28 üblich).</p>
    <p class="ex">Unsicher? Teste mit einer kurzen Datei und schau dir das Ergebnis an. Die Voreinstellungen oben („Klein“, „Archiv“ …) setzen sinnvolle Werte.</p>`},
  vPreset: {t: 'Geschwindigkeit', b: `<p>Wie viel Mühe sich der Encoder gibt.</p>
    <ul><li><b>Langsam:</b> kleinere Datei bei <i>gleicher</i> Qualität, dauert länger.</li><li><b>Mittel:</b> guter Kompromiss.</li><li><b>Sehr schnell:</b> schnell fertig, Datei etwas größer.</li></ul>
    <p>Die Qualität (Aussehen) bestimmt <b>nur der CRF-Regler</b>, nicht diese Einstellung. Bei Hardware-Encodern ist der Unterschied klein.</p>`},
  vDepth: {t: 'Bit-Tiefe (8 / 10 Bit)', b: `<p>Wie fein Farbverläufe gespeichert werden: 8 Bit = 256 Stufen pro Farbe, 10 Bit = 1024 Stufen. Fast alle Filme/DVDs/Blu-rays sind 8 Bit; 4K-Blu-rays und HDR-Material sind 10 Bit.</p>
    <ul><li><b>Wie Quelle (empfohlen):</b> 8-Bit-Film bleibt 8 Bit, 10-Bit/HDR bleibt 10 Bit.</li>
    <li><b>8-Bit-Datei → 10 Bit umwandeln?</b> Geht, es entstehen aber <b>keine neuen Farben</b>. Trotzdem sinnvoll bei H.265/AV1: Der Encoder rechnet genauer, es gibt weniger „Streifen“ in Himmel/Nebel/dunklen Szenen und die Datei wird oft etwas kleiner. Gut fürs Archiv. Bei H.264 bringt es kaum etwas.</li>
    <li><b>10-Bit/HDR → 8 Bit:</b> nur wenn ein Gerät nichts anderes kann. Bei HDR werden die Farben dann blass/falsch, außerdem kann Banding auftreten.</li></ul>
    <p><b>Abspielen:</b> 10-Bit-H.265 läuft auf den meisten Geräten ab ca. 2016, 10-Bit-H.264 dagegen auf vielen TVs/Handys <b>nicht</b>. Für maximale Kompatibilität: 8 Bit.</p>
    <p><b>Hardware:</b> 10 Bit geht per Grafikchip nur mit H.265/AV1 und nur bei neueren GPUs – sonst ist die Option ausgegraut.</p>
    <p class="ex">Faustregel: H.265/AV1 fürs Archiv → 10 Bit. Für alte Fernseher/Player → 8 Bit. Sonst „Wie Quelle“.</p>`},
  vHeight: {t: 'Auflösung (max. Höhe)', b: `<p>Verkleinert das Bild auf höchstens diese Höhe in Pixeln. Das Seitenverhältnis bleibt erhalten. <b>Kleineres Bild = viel kleinere Datei.</b></p>
    <ul><li>2160p = 4K · 1080p = Full HD · 720p = HD · 480p = DVD-Qualität</li></ul>
    <p class="ex">Beispiel: 4K-Film (60 GB) auf 1080p → oft nur 8–12 GB. Ein 720p-Video bei Wahl „1080p“ wird <b>nicht</b> aufgeblasen.</p>
    <p>Original = keine Änderung der Größe.</p>`},
  vHwDec: {t: 'Hardware-Decoding', b: `<p>Ein Umwandeln besteht aus <b>Lesen</b> (Quelle entpacken = Decodieren) und <b>Schreiben</b> (neu verpacken = Encodieren). Mit dieser Option macht auch beim Lesen die Hardware (z. B. Quick Sync) die Arbeit. Das entlastet die CPU.</p>
    <p>Klappt es bei einer Datei nicht, probiert das Programm automatisch andere Wege (zuletzt: die CPU liest) – du musst nichts tun und bekommst keine Fehlermeldung. In der Warteschlange steht dann „Lesen: CPU“. Im Zweifel angehakt lassen.</p>`},
  vAudioMode: {t: 'Audiospuren', b: `<ul><li><b>Passthrough:</b> Der Ton wird 1:1 kopiert – keine Qualitätsverluste, geht blitzschnell (auch Dolby/DTS-Surround). <b>Empfohlen.</b></li>
    <li><b>Neu kodieren:</b> Ton wird in ein anderes Format umgerechnet, z. B. um Platz zu sparen (DTS-HD/TrueHD sind riesig) oder weil ein Gerät das Format nicht kann.</li></ul>
    <p class="ex">Beispiel: Blu-ray mit 4 GB Ton → „AAC“ oder „Opus“ spart mehrere GB.</p>`},
  vAudioCodec: {t: 'Audio-Codec / Bitrate', b: `<ul><li><b>AAC:</b> läuft überall, guter Standard.</li><li><b>Opus:</b> sehr effizient, kleine Dateien (MKV ok, manche TVs nicht).</li><li><b>AC-3 / E-AC-3:</b> Dolby-Formate, nötig für manche Heimkino-Receiver.</li><li><b>FLAC:</b> verlustfrei, groß.</li></ul>
    <p>Die Bitrate gilt für <b>Stereo</b> (z. B. 160 kbit/s). Surround-Spuren bekommen automatisch mehr (5.1 ≈ 2,5×).</p>`},
  vAudioLangs: {t: 'Audio-Sprachen behalten', b: `<p>Entfernt alle Tonspuren, deren Sprache nicht in der Liste steht. Leer = alle behalten.</p>
    <p class="ex">Beispiel: <code>ger,eng</code> behält Deutsch und Englisch, entfernt z. B. Französisch und Spanisch. Auch <code>de,en</code> funktioniert.</p>
    <p>Spuren ohne Sprachangabe bleiben erhalten. Würde der Filter <b>alle</b> Spuren entfernen, wird er ignoriert.</p>`},
  vSubMode: {t: 'Untertitel', b: `<ul><li><b>Passthrough:</b> alle Untertitel werden übernommen (in MKV ohne Verlust).</li><li><b>Alle entfernen:</b> keine Untertitel in der neuen Datei.</li></ul>
    <p>Einzelne Untertitel pro Datei änderst du unten in der Tabelle „Einzelne Spuren“.</p>
    <p class="ex">Hinweis: In MP4 gehen Bild-Untertitel (Blu-ray/PGS, DVD) nicht – nimm dafür MKV.</p>`},
  vSubLangs: {t: 'Untertitel-Sprachen behalten', b: `<p>Wie bei den Audio-Sprachen: nur diese Sprachen behalten, leer = alle.</p>
    <p class="ex">Beispiel: <code>ger</code> → nur deutsche Untertitel.</p>`},
  vAudioTracks: {t: 'Audiospuren', b: `<p>Regeln für den Ton in <b>allen</b> Dateien. Standard ist „Passthrough“: Alle Tonspuren bleiben unverändert. Einzelne Spuren änderst du unten in der Tabelle.</p>`},
  vSubTracks: {t: 'Untertitel', b: `<p>Regeln für die Untertitel in <b>allen</b> Dateien. Standard ist „Passthrough“: Alle Untertitel bleiben unverändert.</p>`},
  trkTable: {t: 'Einzelne Spuren', b: `<p>Zeigt alle Ton- und Untertitelspuren der gewählten Datei. Was du hier änderst, gilt nur für diese Datei – oder per „Auf alle Dateien anwenden“ für alle.</p>
    <ul><li><b>Behalten:</b> Abwählen entfernt die Spur (z. B. Kommentar-Tonspur, fremde Untertitel).</li>
    <li><b>Aktion:</b> „Standard“ folgt den Regeln oben, „Unverändert kopieren“ lässt die Spur unberührt (auch wenn die Regeln oben sie entfernen würden), „Neu kodieren“ wandelt nur diese Tonspur um.</li>
    <li><b>Titel:</b> Name der Spur im Player-Menü, z. B. „Deutsch 5.1“.</li>
    <li><b>Sprache:</b> Dreibuchstabiger Code (ISO 639-2), z. B. <code>ger</code>, <code>eng</code>, <code>jpn</code>. Nur so erkennt Plex die Sprache sicher.</li>
    <li><b>Forced:</b> Markiert einen Untertitel als „erzwungen“ (nur fremdsprachige Stellen). Plex erkennt das nur in MKV und nur, wenn die Untertitelsprache zur Tonspur passt.</li>
    <li><b>Standard:</b> Die Spur, die der Player von selbst startet. Bei Ton gibt es genau eine.</li></ul>
    <p class="ex">Nach dem Umwandeln in Plex das Element bzw. die Bibliothek neu analysieren („Analysieren“), sonst zeigt Plex noch die alten Angaben.</p>`},
  conc: {t: 'Parallel', b: `<p>Wie viele Dateien gleichzeitig umgewandelt werden.</p>
    <ul><li><b>Video mit CPU: 1</b> – ein Auftrag nutzt schon alle Kerne.</li><li>Video mit Hardware: 1–2.</li><li>Audio: 2–4, geht deutlich schneller.</li></ul>`},
  setStart: {t: 'Startansicht', b: `<p>Welche Welt (Audio oder Video) beim Öffnen von p5converter zuerst erscheint. „Zuletzt benutzte Welt“ merkt sich deine letzte Wahl.</p>`},
  setWorlds: {t: 'Welten & Farben', b: `<p>Audio und Video sind zwei „Welten“. Jede hat einen Namen, eine Farbe und einen Planeten. Die Farbe färbt die ganze Oberfläche – so siehst du sofort, in welcher Welt du gerade bist.</p><p class="ex">Die Änderungen gelten für alle Geräte (PC, Handy, iPad), weil sie auf dem Server gespeichert werden.</p>`},
  setPresets: {t: 'Voreinstellungen', b: `<p>Eine Voreinstellung ist ein gespeicherter Satz von Einstellungen, z. B. „H.265, CRF 22, 1080p“. Ein Klick darauf stellt alles auf einmal ein.</p><ul><li><b>Vorschlag:</b> erscheint oben im Einstellungs-Panel des Konverters.</li><li><b>✎ Werte:</b> öffnet den Konverter mit dieser Voreinstellung – Einstellungen ändern und „Änderungen speichern“.</li></ul><p class="ex">Neue Voreinstellung: im Konverter einstellen und „💾 Als Voreinstellung speichern“ klicken.</p>`},
  setBackend: {t: 'Bevorzugter Encoder', b: `<p>Welche Hardware im Konverter vorausgewählt ist. „Automatisch“ nimmt die schnellste, die wirklich funktioniert. Wählst du hier z. B. VAAPI, ist es beim nächsten Öffnen vorausgewählt (sofern du im Konverter nicht schon selbst etwas gewählt hast).</p>`},
  setAuth: {t: 'Anmeldung', b: `<p>Schützt p5converter mit Benutzername und Passwort. Das Passwort wird nur als Hash auf dem Server gespeichert.</p><p>Bei vergessenem Passwort: Befehl im Container ausführen oder die Datei in /config löschen (siehe „Passwort vergessen?“).</p><p class="ex">Im reinen Heimnetz ist die Anmeldung optional. Ist die Oberfläche von außen erreichbar, sollte sie an sein.</p>`},
  savedInfo: {t: 'Gewonnener Platz', b: `<p>Zeigt, wie viel Speicherplatz du durch das Konvertieren insgesamt gewonnen hast: Größe der Originale minus Größe der Ergebnisse, getrennt für Audio und Video.</p>
    <p>Gezählt wird jede erfolgreich fertige Datei. Wird eine Datei größer (z. B. MP3 → FLAC), zählt das als Mehrbedarf. Die Summe bleibt gespeichert (Pfad <code>/config</code>), solange dieser Pfad eingehängt ist.</p>`},
  hwInfo: {t: 'Hardware', b: `<p>Zeigt, welche Hardware (Intel-CPU-Videoeinheit, Grafikkarte) für schnelles Umwandeln nutzbar sind. Das Programm prüft das mit echten Mini-Umwandlungen.</p>
    <p>„nicht nutzbar“ heißt: nicht vorhanden, Treiber fehlt, oder (Docker) das Gerät wurde nicht durchgereicht. Der Grund steht darunter.</p>`},
};
