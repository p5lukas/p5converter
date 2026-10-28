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
    <p>Es wird genau der Text gesucht, den du eingibst (Sonderzeichen wie <code>[</code> oder <code>(</code> sind ganz normale Zeichen). Groß- und Kleinschreibung ist egal.</p>
    <p>Die Vorschau zeigt sofort das Ergebnis; Endung und Ordner bleiben unberührt.</p>`},
  exists: {t: 'Wenn Datei existiert', b: `<p>Was passieren soll, wenn es die Zieldatei schon gibt.</p>
    <ul><li><b>Beide behalten, neue Datei nummerieren:</b> Die vorhandene Datei bleibt, die neue bekommt eine Nummer, z. B. <code>Film (2).mkv</code>. Nichts geht verloren – die sicherste Wahl.</li>
    <li><b>Überspringen, vorhandene Datei nicht anfassen:</b> Die Datei wird nicht erneut umgewandelt. Gut, wenn du einen Ordner nach einem Abbruch noch einmal startest.</li>
    <li><b>Überschreiben, vorhandene Datei ersetzen:</b> Die alte Zieldatei wird durch die neue ersetzt. Das lässt sich nicht rückgängig machen.</li></ul>`},
  deleteSource: {t: 'Quelldatei löschen', b: `<p>Löscht das Original, <b>nachdem</b> die neue Datei fertig ist <b>und die Prüfung bestanden hat</b>. Das ist <b>endgültig</b> (kein Papierkorb).</p>
    <p>Fällt die Prüfung durch, bleibt das Original liegen und am Auftrag steht eine Warnung.</p>
    <p>Empfehlung für Anfänger: aus lassen, erst Ergebnis ansehen/anhören, dann selbst aufräumen.</p>`},
  vfInfo: {t: 'Ergebnis prüfen & Original', b: `<p>Jede neue Datei wird immer geprüft: lässt sie sich lesen und ist sie (fast) genauso lang wie das Original?</p>
    <ul><li><b>Spuren &amp; Größe:</b> Sind alle gewählten Video-, Audio- und Untertitelspuren drin? Ist die Datei nicht absurd klein? Kostet fast keine Zeit.</li>
    <li><b>Komplett durchlesen (Decode-Test):</b> ffmpeg liest die ganze neue Datei einmal durch, ohne etwas zu speichern, und meldet beschädigte Stellen. Das geht schneller als abspielen, dauert bei langen Videos aber merklich (grob 5–10 Minuten für einen 2-Stunden-Film in 1080p, bei 4K mehr).</li></ul>
    <p>Fällt eine Prüfung durch, bleibt das Original unangetastet und der Auftrag zeigt eine Warnung. Die Zeitangaben sind Schätzwerte.</p>
    <p class="ex">Die Standardauswahl legst du in Einstellungen → Allgemein fest, getrennt für Audio und Video.</p>`},

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
  vResolved: {t: 'Wird verwendet', b: `<p>Zeigt den Encoder, den das Programm mit deinen Einstellungen einsetzt, z. B. <code>hevc_qsv</code> mit dem Schild „Intel Quick Sync“ oder <code>libx265</code> mit „CPU“. Bei „Automatisch“ gilt der bevorzugte Encoder aus Einstellungen → Hardware, sonst der schnellste verfügbare.</p>
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
    <p>Die Bitrate gilt <b>je Stereo-Paar</b> (Empfehlung: AAC 160 kbit/s). Spuren mit mehr Kanälen bekommen automatisch mehr: Wert × Kanäle ÷ 2, höchstens 640. Bei 160 kbit/s sind das für Stereo 160, für 5.1 (6 Kanäle) <b>480</b> und für 7.1 (8 Kanäle) 640 kbit/s. Unter dem Feld steht, was bei dir herauskommt.</p>`},
  vSubMode: {t: 'Untertitel', b: `<ul><li><b>Passthrough:</b> alle Untertitel werden übernommen (in MKV ohne Verlust).</li><li><b>Alle entfernen:</b> keine Untertitel in der neuen Datei.</li></ul>
    <p>Einzelne Untertitel änderst du in den Ansichten darunter. Welche Sprachen bleiben, legst du in Einstellungen → Audio &amp; Untertitel fest.</p>
    <p class="ex">Hinweis: In MP4 gehen Bild-Untertitel (Blu-ray/PGS, DVD) nicht – nimm dafür MKV.</p>`},
  trkRules: {t: 'Regeln nach Format', b: `<p>Damit wandelst du nur bestimmte Spuren um oder entfernst sie, statt alle Spuren gleich zu behandeln. Die Regeln laufen <b>von oben nach unten</b>, die <b>erste passende</b> gewinnt. Deine eigenen Änderungen an einer Spur gehen immer vor.</p>
    <p class="ex">Beispiel: „DTS → umwandeln in AC-3 192 kbit/s je Stereo-Paar“. Alle anderen Tonspuren bleiben unverändert (oder folgen „Alle übrigen Tonspuren“). Mit „Surround“ oder „Stereo“ grenzt du nach Kanälen ein.</p>
    <p>Für Untertitel gibt es keine Regeln: Du entscheidest sie je Datei oder Gruppe in der Kontrolle (Schritt 4), die Sprachen legst du unter „Audio &amp; Untertitel“ fest. Bild-Untertitel (PGS, VobSub, DVB) sind groß und nicht überall abspielbar, deshalb steht das dort als Hinweis, entfernt wird nichts von selbst.</p>
    <p>Die Regeln lassen sich als Voreinstellung speichern (Diskette im Ablauf). Das Programm schlägt Regeln vor, wenn es passende Spuren in deinen Dateien findet (z. B. DTS).</p>`},
  trkViews: {t: 'Gruppen, Tabelle, Einzelne Dateien', b: `<ul><li><b>Gruppen:</b> Dateien mit denselben Sprachen sind zusammengefasst (z. B. eine ganze Staffel). Ein Haken bei einer Sprache gilt für die ganze Gruppe. Abweichende Dateien stehen in eigenen, markierten Gruppen. Jede Gruppe zeigt, was passieren wird.</li>
    <li><b>Tabelle:</b> Alle Dateien als Zeilen, alle Sprachen als Spalten, mit Häkchen. Der Haken in der Spaltenüberschrift gilt für alle Dateien.</li>
    <li><b>Einzelne Dateien:</b> jede Spur einer Datei als Karte mit allen Einstellungen (Titel, Sprache, Forced, Standard, Format).</li></ul>`},
  trkPrefs: {t: 'Sprach-Wünsche', b: `<p>Hier legst du einmal fest, welche Sprachen du haben willst. In der Tabelle „Vorher → Nachher“ wird das dann bei jeder Datei automatisch angewendet (mit dem Funkel-Zeichen markiert) – und die Tipps berücksichtigen es.</p>
    <ul><li><b>Behalten:</b> andere Sprachen werden entfernt (leer = nichts entfernen). Hat eine Datei keine deiner Sprachen, bleibt sie unverändert.</li>
    <li><b>Standard:</b> eine Rangliste. Die erste Sprache, die in der Datei vorkommt, wird zur Spur, die der Player automatisch startet (z. B. Deutsch, sonst Englisch).</li>
    <li><b>Forced:</b> „Deutsch (Forced)“ heißt: der erzwungene Untertitel, der nur bei fremdsprachigen Stellen erscheint.</li></ul>
    <p>Reihenfolge ändern: ziehen oder ▲ ▼. Die Wünsche gelten für Video.</p>`},
  vAudioTracks: {t: 'Audiospuren', b: `<p>Regeln für den Ton in <b>allen</b> Dateien. Standard ist „Passthrough“: Alle Tonspuren bleiben unverändert. Einzelne Spuren änderst du unten in der Tabelle.</p>`},
  vSubTracks: {t: 'Untertitel', b: `<p>Regeln für die Untertitel in <b>allen</b> Dateien. Standard ist „Passthrough“: Alle Untertitel bleiben unverändert.</p>`},
  trkTable: {t: 'Spuren dieser Datei', b: `<p>Jede Ton- und Untertitelspur der gewählten Datei als Karte. Was du hier änderst, gilt nur für diese Datei – oder mit „Auf alle Dateien anwenden“ für alle.</p>
    <ul><li><b>Häkchen:</b> Spur behalten. Ohne Häkchen wird sie entfernt (z. B. Kommentar-Tonspur, fremde Untertitel).</li>
    <li><b>So lassen / Kleiner machen (nur Ton):</b> „So lassen“ ist verlustfrei und am schnellsten. „Kleiner machen“ rechnet nur diese Tonspur um; Format und Bitrate sind schon sinnvoll vorausgefüllt.</li>
    <li><b>Erweitert:</b> Titel (so heißt die Spur im Player), Sprache, „Forced (erzwungene Untertitel)“ und „startet automatisch“. Forced-Untertitel erscheinen nur bei fremdsprachigen Stellen.</li></ul>
    <p><b>Plex:</b> Die Sprache wird als Code aus drei Buchstaben geschrieben, nur so erkennt Plex sie sicher. „Forced“ erkennt Plex nur in MKV-Dateien, und die Untertitelsprache muss zur Tonspur passen. Danach in Plex das Element neu analysieren („Analysieren“).</p>
    <p class="ex">Die „Tipps zu dieser Datei“ schlagen Sinnvolles per Knopfdruck vor, z. B. nur Deutsch und Englisch behalten.</p>`},
  conc: {t: 'Parallel', b: `<p>Wie viele Dateien gleichzeitig umgewandelt werden.</p>
    <ul><li><b>Video mit CPU: 1</b> – ein Auftrag nutzt schon alle Kerne.</li><li>Video mit Hardware: 1–2.</li><li>Audio: 2–4, geht deutlich schneller.</li></ul>`},
  setPresets: {t: 'Voreinstellungen', b: `<p>Eine Voreinstellung ist ein gespeicherter Satz von Einstellungen, z. B. „H.265, CRF 22, 1080p“. Ein Klick darauf stellt alles auf einmal ein.</p><ul><li><b>Vorschlag:</b> erscheint oben im Einstellungs-Panel des Konverters.</li><li><b>✎ Werte:</b> öffnet den Konverter mit dieser Voreinstellung – Einstellungen ändern und „Änderungen speichern“.</li></ul><p class="ex">Neue Voreinstellung: im Konverter einstellen und „💾 Als Voreinstellung speichern“ klicken.</p>`},
  setBackend: {t: 'Bevorzugter Encoder', b: `<p>Welche Hardware im Konverter vorausgewählt ist. „Automatisch“ nimmt die schnellste, die wirklich funktioniert. Wählst du hier z. B. VAAPI, ist es beim nächsten Öffnen vorausgewählt (sofern du im Konverter nicht schon selbst etwas gewählt hast).</p>`},
  setAuth: {t: 'Anmeldung', b: `<p>Schützt p5converter mit Benutzername und Passwort. Das Passwort wird nur als Hash auf dem Server gespeichert.</p><p>Bei vergessenem Passwort: Befehl im Container ausführen oder die Datei in /config löschen (siehe „Passwort vergessen?“).</p><p class="ex">Im reinen Heimnetz ist die Anmeldung optional. Ist die Oberfläche von außen erreichbar, sollte sie an sein.</p>`},
  savedInfo: {t: 'Gewonnener Platz', b: `<p>Zeigt, wie viel Speicherplatz du durch das Konvertieren insgesamt gewonnen hast, getrennt für <b>Video</b> und <b>Audio</b>: Größe der Originale minus Größe der Ergebnisse. Audio und Video werden getrennt gezählt.</p>
    <p>Gezählt wird jede erfolgreich fertige Datei. Wird eine Datei größer (z. B. MP3 → FLAC), zählt das als Mehrbedarf. Die Summe bleibt gespeichert (Pfad <code>/config</code>), solange dieser Pfad eingehängt ist.</p>
    <p>Mit „Zurücksetzen“ beginnt die Zählung dieser Art bei 0.</p>`},
  hwInfo: {t: 'Hardware', b: `<p>Zeigt, welche Hardware (Intel-CPU-Videoeinheit, Grafikkarte) für schnelles Umwandeln nutzbar sind. Das Programm prüft das mit echten Mini-Umwandlungen.</p>
    <p>„nicht nutzbar“ heißt: nicht vorhanden, Treiber fehlt, oder (Docker) das Gerät wurde nicht durchgereicht. Der Grund steht darunter.</p>`},
  // Ablauf und Kontrolle (0.3.2)
  stepFiles: {t: 'Dateien wählen', b: `<p>Wähle zuerst den <b>Quellordner</b> (z. B. „Filme 4K“): Der Datei-Browser öffnet sich gleich dort.</p>
    <ul><li><b>Suche:</b> tippst du mindestens zwei Buchstaben, durchsucht das Programm <b>immer auch alle Unterordner</b>. Umlaute darfst du so oder so tippen (Müller oder Mueller).</li>
    <li><b>Diesen Ordner (rekursiv):</b> nimmt alle Videos oder Lieder des Ordners samt Unterordnern mit.</li></ul>
    <p class="ex">Du kannst auch oben eine Voreinstellung wählen. Dann geht es nach der Dateiwahl direkt zur Kontrolle.</p>`},
  stepRules: {t: 'Regeln', b: `<p>Hier legst du fest, was mit <b>Tonspuren und Untertiteln</b> allgemein passiert, zum Beispiel „DTS in E-AC-3 umwandeln“ oder „Bild-Untertitel entfernen“.</p>
    <p>Die <b>voreingestellten Regeln</b> aus Einstellungen → Regeln gelten schon. Jede lässt sich für diesen Lauf abwählen. Rechts steht, wie viele deiner Dateien eine Regel betrifft.</p>
    <p class="ex">Hier musst du nichts ändern: Ohne Regeln bleiben alle Spuren unverändert.</p>`},
  stepHow: {t: 'Wie soll umgewandelt werden?', b: `<p>Drei Fragen, jede als Kachel: <b>womit</b> umgewandelt wird (Hardware), <b>wohin</b> gespeichert wird und <b>wie</b> das Ergebnis danach geprüft wird. Unten steht die Zusammenfassung als Satz.</p>
    <p>Alles Weitere (Qualität, Spuren, Name) stellst du im nächsten Schritt in der Kontrolle genauer ein.</p>`},
  stepCheck: {t: 'Kontrolle & Start', b: `<p>Links siehst du, wie die Dateien jetzt sind, rechts, was herauskommt. Die Tabelle ist in vier Karten gegliedert: Video, Audio, Untertitel und Dateiname. Jede Zeile lässt sich direkt ändern.</p>
    <p>Mit <b>Starten</b> unten geht es los. Das Original bleibt unberührt, außer du hast „Original danach löschen“ gewählt.</p>`},
  tileHw: {t: 'Hardware', b: `<p>Wer die Rechenarbeit macht. Hardware (Intel Quick Sync, NVIDIA NVENC, AMD AMF, VAAPI) ist oft 5–20× schneller und schont die CPU. Die CPU braucht länger, liefert bei gleicher Größe aber meist die beste Qualität.</p>
    <p><b>Automatisch</b> nimmt die schnellste Hardware, die wirklich funktioniert (oder deinen bevorzugten Encoder aus Einstellungen → Hardware). Nur nutzbare Einträge lassen sich wählen.</p>
    <p><b>Kopieren (Remux)</b> rechnet gar nichts neu: Das Video wird nur in einen neuen Container verpackt.</p>`},
  tileDest: {t: 'Speichern', b: `<p>Wohin die fertige Datei geschrieben wird: <b>neben die Quelle</b> (gleicher Ordner, neuer Name) oder in einen <b>eigenen Ordner</b>.</p>
    <p><b>Wenn die Datei schon da ist:</b> „Beide behalten“ nummeriert die neue Datei (sicherste Wahl), „Überspringen“ lässt die vorhandene in Ruhe, „Überschreiben“ ersetzt sie endgültig.</p>`},
  tileCheck: {t: 'Danach prüfen', b: `<p>Jede neue Datei wird immer geprüft: lässt sie sich lesen, und ist sie (fast) genauso lang wie das Original? Hier wählst du mehr dazu:</p>
    <ul><li><b>Spuren &amp; Größe:</b> sind alle gewählten Spuren drin, und ist die Datei nicht absurd klein? Kostet kaum Zeit.</li>
    <li><b>Komplett durchlesen:</b> ffmpeg liest die ganze neue Datei einmal durch und meldet beschädigte Stellen. Dauert bei langen Videos merklich.</li>
    <li><b>Original danach löschen:</b> endgültig, kein Papierkorb, und nur wenn alle Prüfungen bestanden sind.</li></ul>
    <p>Wird das Ergebnis bei einem neu kodierten Video <b>nicht kleiner</b> als die Quelle, schlägt die Prüfung an und dein Original bleibt in jedem Fall erhalten.</p>`},
  cardVideo: {t: 'Video', b: `<p>Alles zum Bild: Codec und Auflösung, Container (Dateityp) und Qualität. Links steht die Quelle, rechts das Ergebnis. Geänderte Zeilen sind grün hervorgehoben.</p>`},
  cardAudio: {t: 'Audio', b: `<p>Alle Tonspuren der Datei, eine Zeile je Spur (orange). Pro Spur wählst du <b>unverändert</b>, <b>umwandeln</b> oder <b>entfernen</b>; dazu, welche Spur Standard ist.</p>`},
  cardSubs: {t: 'Untertitel', b: `<p>Alle Untertitel der Datei, eine Zeile je Spur. <b>behalten</b> oder <b>entfernen</b>; dazu „Forced“ und „Standard“.</p>`},
  cardName: {t: 'Dateiname', b: `<p>So heißt die neue Datei. „bleibt“ heißt: Der Name ändert sich nicht (nur die Endung, wenn der Container wechselt). Muster, Zusatz und Ersetzungen stellst du über „ändern“ ein.</p>`},
  cardAudioFile: {t: 'Audio-Datei', b: `<p>Format, Qualität, Samplerate und Kanäle der neuen Datei, daneben die Werte der Quelle. Tags (Titel, Interpret, Album …) werden immer übernommen.</p>`},
  rowVideo: {t: 'Video', b: `<p>Links: Codec, Höhe und Bit-Tiefe der Quelle. Rechts wählst du den neuen <b>Codec</b> (Kopieren = nichts neu berechnen), die <b>Auflösung</b> und die <b>Bit-Tiefe</b>.</p>
    <p class="ex">H.265 spart gegenüber H.264 etwa 30–50 % bei gleicher Qualität.</p>`},
  rowContainer: {t: 'Container', b: `<p>Der „Karton“ aus Bild, Ton und Untertiteln. <b>MKV</b> kann alles (empfohlen für Plex, Jellyfin, Kodi), <b>MP4</b> läuft auf mehr Fernsehern, nimmt aber keine Bild-Untertitel mit.</p>`},
  rowQuality: {t: 'Qualität in vier Stufen', b: `<p>Vier feste Stufen: <b>Sehr gut</b> (groß), <b>Gut</b> (empfohlen), <b>Normal</b> (kleiner) und <b>Klein</b> (weich). Das Programm rechnet jede Stufe je Encoder und Codec in die passende Zahl um (CRF, CQ, ICQ oder QP). Die Zahl siehst du unter „Erweitert“, dort lässt sie sich auch selbst einstellen.</p>
    <p>Links steht die Bitrate der Quelle. Ist sie schon klein (unter etwa 4 Mbit/s bei 1080p), erscheint ein Hinweis: Neu kodieren spart dann kaum Platz.</p>
    <p class="ex">Wird das Ergebnis nicht kleiner als die Quelle, bleibt dein Original in jedem Fall erhalten. Die Zahlen sind Startwerte, nicht auf deiner Hardware gemessen; bei Bereichen gilt der niedrigere Wert.</p>`},
  rowAudio: {t: 'Tonspur', b: `<ul><li><b>unverändert:</b> der Ton wird 1:1 kopiert, ohne Verlust und am schnellsten.</li><li><b>umwandeln:</b> in ein anderes Format (z. B. E-AC-3). Klick auf das Ziel („→ E-AC-3 …“) ändert Format und Bitrate.</li><li><b>entfernen:</b> die Spur kommt nicht in die neue Datei.</li></ul>
    <p><b>Standard</b> ist die Spur, die der Player von selbst startet; es gibt immer höchstens eine. Ein Klick auf eine andere Spur setzt sie, ein Klick auf die gesetzte nimmt die eigene Wahl zurück.</p>
    <p>Links steht die Kennung der Spur („E-AC-3 (Dolby Digital Plus) 5.1 · 640 kbit/s“): zuerst der Codec, in Klammern der Markenname, dann Kanäle und Bitrate. „⋯“ öffnet Titel und Sprache.</p>`},
  rowSub: {t: 'Untertitel', b: `<ul><li><b>behalten</b> oder <b>entfernen</b> je Spur.</li><li><b>Forced</b> = erzwungene Untertitel, die nur bei fremdsprachigen Stellen erscheinen (Plex erkennt das nur in MKV).</li><li><b>Standard</b> = startet automatisch.</li></ul>
    <p>Ist ein Untertitel viel kleiner als der gleichsprachige vollständige, schlägt das Programm „Forced“ vor.</p>`},
  rowName: {t: 'Dateiname', b: `<p>So heißt die neue Datei (Beispiel für die erste Datei der Gruppe). „bleibt“ = der Name ändert sich nicht. „ändern“ öffnet Namensmuster, Zusatz und Ersetzungen.</p>`},
  autoMark: {t: 'Funkel-Markierung', b: `<p>Das Funkel-Zeichen steht nur bei dem, was das Programm <b>selbst erkannt oder angepasst</b> hat: Regeln, Sprach-Wünsche, erkannte Forced-Untertitel und Übernahmen aus einer kontrollierten Gruppe. Gewöhnliche Standardvorschläge bekommen keine Markierung.</p>
    <p>Mit „rückgängig“ nimmst du die Anpassung zurück; mit „Vorschlag“ übernimmst du einen Hinweis per Knopfdruck.</p>`},
  groups: {t: 'Gruppen', b: `<p>Dateien mit gleichen Rahmendaten (Video, Tonspuren, Sprachen, Formate) bilden eine <b>Gruppe</b>; eine Entscheidung gilt für die ganze Gruppe (die zweite Tonspur ist überall die zweite).</p>
    <p>Abweichend aufgebaute Dateien sind eine eigene Gruppe und müssen <b>kontrolliert</b> werden. Entscheidungen einer kontrollierten Gruppe werden bei gleichen Spuren anderer Gruppen übernommen („Übernommen“).</p>`},
  trkGlobal: {t: 'Voreingestellte Regeln', b: `<p>Allgemeine Regeln aus Einstellungen → Regeln, zum Beispiel „DTS → E-AC-3, 256 kbit/s je Stereo-Paar“. Sie gelten bei jedem Lauf. Mit dem Haken schaltest du eine Regel für <b>diesen Lauf</b> aus.</p>
    <p>Rechts steht, wie viele deiner Dateien die Regel betrifft. Die Bitrate gilt je Stereo-Paar; eine 5.1-Spur bekommt mehr (Wert × Kanäle ÷ 2), höchstens 640 kbit/s.</p>`},
  libScan: {t: 'Wo lohnt sich das Umwandeln?', b: `<p>Prüft einen Ordner samt allen Unterordnern und zeigt, <b>bei welchen Ordnern</b> sich das Umwandeln eher lohnt. Es werden nie einzelne Dateien vorgeschlagen, immer nur ganze Ordner (zum Beispiel eine Staffel, und darüber die ganze Serie).</p>
    <p>Die Dateien werden nur <b>gelesen</b> (ffprobe, zwei gleichzeitig), nichts wird verändert. Was gelesen wurde, merkt sich der Server (mit Größe und Änderungsdatum): ein zweiter Durchlauf liest nur <b>neue oder geänderte</b> Dateien und ist deshalb viel schneller. Es gibt <b>keine Schätzung</b>, wie viel du sparst, nur Fakten und Hinweise:</p>
    <ul><li><b>Älterer Codec:</b> H.264, MPEG-4 und Ähnliches statt H.265/AV1.</li><li><b>Hohe Bitrate:</b> die Datei ist für ihre Auflösung sehr groß (ab etwa 8 Mbit/s bei 1080p).</li>
    <li><b>Schwerer Ton / DTS:</b> DTS-HD und TrueHD sind riesig, DTS spielen viele Fernseher nicht.</li><li><b>Bild-Untertitel:</b> PGS und VobSub sind groß und nicht überall abspielbar.</li>
    <li><b>Schon klein:</b> Neukodieren spart hier kaum Platz.</li></ul>
    <p>Die Hinweise stehen oben als <b>Kärtchen</b> und lassen sich einzeln an- und abwählen. Ein Ordner erscheint, sobald <b>mindestens ein</b> gewählter Hinweis zutrifft. Wenn du zum Beispiel nur „Hohe Bitrate“ anlässt, siehst du nur diese Ordner, nach Bitrate sortiert.</p>
    <p>„Ordner übernehmen“ legt den ganzen Ordner mit allen Unterordnern in Schritt 1 ab.</p>`},
  setRules: {t: 'Regeln', b: `<p>Allgemeine Regeln für Tonspuren von Videos, auf dem Server gespeichert und für alle Geräte gültig. Beim Konvertieren erscheinen sie als voreingestellte Regeln, jede lässt sich je Lauf abwählen.</p>
    <p>Die Regeln laufen von oben nach unten, die erste passende gewinnt. Beispiel: „DTS → umwandeln in E-AC-3 mit 256 kbit/s je Stereo-Paar“.</p>
    <p class="ex">E-AC-3 (und AC-3) schafft höchstens 640 kbit/s. Bei 5.1 ergeben 256 je Stereo-Paar rechnerisch 768; das Programm deckelt dann auf 640 und zeigt „Maximum“.</p>`},
};
