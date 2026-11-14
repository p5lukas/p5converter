#!/bin/sh
# Führt UI-Prüfungen (tools/ui-check*.js) aus: baut das Programm, erzeugt bei Bedarf die Testmedien (tools/make-fixtures.sh) und
# startet pro Prüfung einen frischen Server mit leerer Konfiguration.
# Aufruf: sh tools/run-ui-checks.sh                      (alle außer ui-check-news.js)
#         sh tools/run-ui-checks.sh tools/ui-check-home.js tools/ui-check-queue.js
# Die Prüfungen bekommen je nach Bedarf den Ordner season (Episoden) oder media als INDIR.
# Umgebung: P5_FIXTURES (Standard /tmp/p5c-fixtures), SHOTS (Screenshots, Standard /tmp/shots), PORT 8787 muss frei sein.
cd "$(dirname "$0")/.." || exit 1
FIX="${P5_FIXTURES:-/tmp/p5c-fixtures}"; WORK="${P5_WORK:-/tmp/p5c-ui}"; SHOTS="${SHOTS:-/tmp/shots}"
[ -s "$FIX/season/ep06.mkv" ] && [ -s "$FIX/media/forced.mkv" ] && [ -s "$FIX/many60/Film60/film60.mkv" ] || sh tools/make-fixtures.sh "$FIX" || exit 1
go build -o "$WORK-bin" . || exit 1
mkdir -p "$SHOTS"
[ $# -gt 0 ] || set -- $(ls tools/ui-check*.js | grep -v ui-check-news.js)
FAIL=0
for t in "$@"; do
  pkill -x "$(basename "$WORK-bin")" 2>/dev/null; sleep 1
  rm -rf "$WORK"; mkdir -p "$WORK/cfg" "$WORK/out"
  P5_CONFIG="$WORK/cfg" P5_ROOTS="$FIX/season,$FIX/media,$FIX/many60,$WORK/out" nohup "$WORK-bin" >"$WORK/server.log" 2>&1 &
  sleep 2
  printf '=== %s\n' "$t"
  # Prüfungen mit Episoden (ep01–ep06) brauchen den Ordner „season“, alle anderen „media“
  case "$t" in
    *ui-check-convert.js|*ui-check-discard.js|*ui-check-library.js|*ui-check-rules.js|*ui-check-source.js) IN="$FIX/season" ;;
    *) IN="$FIX/media" ;;
  esac
  out=$(INDIR="$IN" OUTDIR="$WORK/out" SHOTS="$SHOTS" timeout 900 node "$t" 2>&1); rc=$?
  echo "$out" | tail -15
  if [ $rc -ne 0 ] || echo "$out" | grep -q "FEHLER\|Error"; then FAIL=1; echo "-> FEHLGESCHLAGEN: $t"; fi
done
pkill -x "$(basename "$WORK-bin")" 2>/dev/null
[ $FAIL -eq 0 ] && echo "Alle Prüfungen bestanden." || { echo "Es gab Fehler."; exit 1; }
