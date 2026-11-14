#!/bin/sh
# Erzeugt die Testmedien für die UI-Prüfungen (tools/ui-check*.js) mit ffmpeg – alles synthetisch, wenige hundert MB, reproduzierbar.
# Aufruf: sh tools/make-fixtures.sh [Zielordner]      (Standard: /tmp/p5c-fixtures)
# Ergebnis: <Ziel>/season – ep01–ep06 (INDIR für Bibliothek, Regeln, Konvertieren, Quelle, Verwerfen)
#           <Ziel>/media  – die übrigen Testdateien (INDIR der anderen Prüfungen)
#           <Ziel>/many60 – 60 Ordner mit je einer kleinen Datei (Bibliothek-Test mit vielen Ordnern)
set -e
OUT="${1:-/tmp/p5c-fixtures}"
A="$OUT/media"; S="$OUT/season"; M="$OUT/many60"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
command -v ffmpeg >/dev/null || { echo "ffmpeg fehlt"; exit 1; }
mkdir -p "$A" "$S" "$M"
F="ffmpeg -loglevel error -y"
V720="-f lavfi -i testsrc2=s=1280x720:r=24"
x264="-c:v libx264 -preset ultrafast -crf 30"
want() { [ -s "$A/$1" ] && return 1; echo "  $1"; return 0; }

echo "Erzeuge Testmedien in $OUT"
# ep01–ep05: 720p H.264, Ton ger (DTS, mono) / eng (AC-3, mono) / fre (AAC, mono), Untertitel ger/eng/fre; ep06: nur eng (Ton AAC, ein Untertitel)
# (Ordner „season“: Quelle für Bibliothek, Regeln, Konvertieren, Umwandlungsvorschläge)
printf '1\n00:00:00,000 --> 00:00:01,000\nHallo\n\n' > "$T/kurz.srt"
for i in 1 2 3 4 5; do
  [ -s "$S/ep0$i.mkv" ] || { echo "  season/ep0$i.mkv"; $F $V720:d=10 -f lavfi -i sine=d=10 -f lavfi -i sine=f=500:d=10 -f lavfi -i sine=f=700:d=10 \
    -i "$T/kurz.srt" -i "$T/kurz.srt" -i "$T/kurz.srt" -map 0 -map 1 -map 2 -map 3 -map 4 -map 5 -map 6 $x264 \
    -ac 1 -c:a:0 dca -strict -2 -c:a:1 ac3 -c:a:2 aac -c:s srt \
    -metadata:s:a:0 language=ger -metadata:s:a:1 language=eng -metadata:s:a:2 language=fre \
    -metadata:s:s:0 language=ger -metadata:s:s:1 language=eng -metadata:s:s:2 language=fre \
    -disposition:a:0 0 -disposition:a:1 default -disposition:a:2 0 "$S/ep0$i.mkv"; }
done
[ -s "$S/ep06.mkv" ] || { echo "  season/ep06.mkv"; $F $V720:d=10 -f lavfi -i sine=d=10 -i "$T/kurz.srt" -map 0 -map 1 -map 2 $x264 -ac 1 -c:a aac -c:s srt \
  -metadata:s:a:0 language=eng -metadata:s:s:0 language=eng "$S/ep06.mkv"; }
# long.mkv: 90 s, lang genug, dass ein Auftrag während der Prüfung läuft (Warteschlange, Balken, Regen)
want long.mkv && $F $V720:d=90 -f lavfi -i sine=d=90 $x264 -c:a aac "$A/long.mkv"
want hint.mkv && $F -f lavfi -i testsrc2=s=640x360:r=24:d=5 -f lavfi -i sine=d=5 -c:v libx264 -preset ultrafast -c:a aac "$A/hint.mkv"
want a.mp3 && $F -f lavfi -i sine=d=3 -c:a libmp3lame "$A/a.mp3"
# Umbenennen: Name mit Folgen-Nummer und Qualitätskennzeichen, Bild 720p
want "Show S01E01 [WEBDL-1080p].mkv" && $F $V720:d=5 -f lavfi -i sine=d=5 $x264 -c:a aac "$A/Show S01E01 [WEBDL-1080p].mkv"
for e in 2 3; do want "Show S01E0$e [WEBDL-1080p].mkv" && cp "$A/Show S01E01 [WEBDL-1080p].mkv" "$A/Show S01E0$e [WEBDL-1080p].mkv"; done

# multi.mkv / multi2.mkv: je 2 Ton- (ger, eng) und 2 Untertitelspuren (ger, eng)
python3 - "$T" <<'PY'
import sys
t = sys.argv[1]
def t_(s): return "%02d:%02d:%02d,000" % (s // 3600, s % 3600 // 60, s % 60)
open(t + "/voll.srt", "w").write("".join("%d\n%s --> %s\nZeile %d\n\n" % (i, t_(i), t_(i) .replace(",000", ",500"), i) for i in range(1, 151)))
open(t + "/forced.srt", "w").write("".join("%d\n%s --> %s\nForced %d\n\n" % (i, t_(i), t_(i).replace(",000", ",500"), i) for i in range(1, 5)))
PY
for f in multi multi2; do
  want "$f.mkv" && $F -f lavfi -i testsrc2=s=640x360:r=24:d=20 -f lavfi -i sine=d=20 -f lavfi -i sine=f=600:d=20 -i "$T/kurz.srt" -i "$T/kurz.srt" \
    -map 0 -map 1 -map 2 -map 3 -map 4 -c:v libx264 -preset ultrafast -c:a aac -c:s srt \
    -metadata:s:a:0 language=ger -metadata:s:a:1 language=eng -metadata:s:s:0 language=ger -metadata:s:s:1 language=eng "$A/$f.mkv"
done
# forced.mkv: Ton ger, Untertitel ger mit 150 Zeilen und ger mit 4 Zeilen (Forced-Erkennung nach Größe)
want forced.mkv && $F -f lavfi -i testsrc2=s=640x360:r=24:d=200 -f lavfi -i sine=d=200 -i "$T/voll.srt" -i "$T/forced.srt" \
  -map 0 -map 1 -map 2 -map 3 -c:v libx264 -preset ultrafast -c:a aac -c:s srt \
  -metadata:s:a:0 language=ger -metadata:s:s:0 language=ger -metadata:s:s:1 language=ger \
  -metadata:s:s:0 NUMBER_OF_FRAMES-ger=150 -metadata:s:s:0 NUMBER_OF_BYTES-ger=3000 -metadata:s:s:1 NUMBER_OF_FRAMES-ger=4 -metadata:s:s:1 NUMBER_OF_BYTES-ger=80 "$A/forced.mkv"

# many60: 60 Ordner, je eine kurze Datei
if [ ! -s "$M/Film60/film60.mkv" ]; then
  $F -f lavfi -i testsrc2=s=320x180:r=12:d=2 -f lavfi -i sine=d=2 -c:v libx264 -preset ultrafast -c:a aac "$T/klein.mkv"
  for i in $(seq 1 60); do mkdir -p "$M/Film$i"; cp "$T/klein.mkv" "$M/Film$i/film$i.mkv"; done
fi
echo "fertig: $(ls "$S" | wc -l) Dateien in $S, $(ls "$A" | wc -l) in $A, 60 Ordner in $M"
