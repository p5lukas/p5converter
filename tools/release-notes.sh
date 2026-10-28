#!/bin/sh
# Release-Text aus dem CHANGELOG: sh tools/release-notes.sh VERSION [SEIT_VERSION]
# Gibt die Abschnitte von CHANGELOG.md aus, deren Version größer als SEIT_VERSION und höchstens VERSION ist (neueste zuerst), unter „Änderungen“.
# Ohne SEIT_VERSION nur der Abschnitt von VERSION. Dazu eine kurze Kopfzeile mit den Downloads. Beispiel: sh tools/release-notes.sh 0.4.0 0.3.0
set -eu
ver="${1:?Version fehlt (z. B. 0.3.7)}"
since="${2:-}"
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="${GITHUB_REPOSITORY:-p5lukas/p5converter}"
tag="$(printf '%s' "$ver" | sed 's/-.*$//')"
# ASSETS (Leerzeichen-getrennte Dateinamen am Release) schränkt die Download-Zeile ein; ohne ASSETS stehen alle Downloads da (neues Release)
dl=""
for f in "p5converter-setup.exe:(Windows)" "p5converter.xml:(Unraid-Vorlage)"; do
  name="${f%%:*}"; what="${f#*:}"
  if [ -z "${ASSETS:-}" ] || printf ' %s ' "$ASSETS" | grep -q " $name "; then dl="$dl\`$name\` $what · "; fi
done
cat <<HEAD
**Downloads:** ${dl}Docker: \`ghcr.io/$repo:$tag\`
Installation und Hinweise: [README](https://github.com/$repo#readme) · Vorabversion, noch nicht für den Dauerbetrieb gedacht.

## Änderungen

HEAD
awk -v ver="$ver" -v since="$since" '
  function key(v,   a) { split(v, a, "."); return a[1] * 1000000 + a[2] * 1000 + a[3] }
  /^## [0-9]+\.[0-9]+\.[0-9]+/ {
    v = $2
    on = (key(v) <= key(ver)) && (since == "" ? key(v) == key(ver) : key(v) > key(since))
    if (on) { sub(/^## /, "### "); print; next }
  }
  /^## / { on = 0 }
  on { print }
' "$here/CHANGELOG.md" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
