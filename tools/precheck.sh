#!/bin/sh
# Vorprüfung vor jedem Push: alles, was die CI auch prüft (und woran sie bisher oft gescheitert ist), lokal in einem Rutsch.
# Aufruf: sh tools/precheck.sh          (schnell: sh tools/precheck.sh quick – ohne go test -race)
# Nicht ersetzbar (läuft nur in der CI): echter Windows-Lauf (Fenster, Installer), GPU-Pfade, Docker-Image-Smoke-Test.
cd "$(dirname "$0")/.." || exit 1
FAIL=0
step() { printf '\n== %s\n' "$1"; }
bad() { echo "FEHLER: $1"; FAIL=1; }

step "gofmt"
out=$(gofmt -l . 2>&1); [ -z "$out" ] || bad "nicht formatiert: $out"

step "go vet"
go vet ./... || bad "go vet"

step "Windows-Build (GOOS=windows CGO_ENABLED=0) – findet z. B. fehlende Importe, die go vet nicht meldet"
GOOS=windows CGO_ENABLED=0 go build -o /dev/null . || bad "Windows-Build"

step "go.mod: Go-Version und Toolchain unverändert (kein Sprung durch go mod tidy)"
grep -q '^go 1\.24\.7$' go.mod || bad "go.mod: 'go 1.24.7' erwartet (go mod tidy hat die Version verändert?)"
! grep -q '^toolchain' go.mod || bad "go.mod: 'toolchain'-Zeile gefunden"
grep -q 'golang.org/x/sys v0.33.0' go.mod || bad "go.mod: golang.org/x/sys v0.33.0 erwartet"

step "JavaScript-Syntax (node --check)"
for f in web/*.js tools/*.js; do node --check "$f" || bad "Syntax $f"; done

step "Logik von Audio & Untertitel (web/trkplan.js, Node-Test)"
node tools/test-trkplan.js || bad "tools/test-trkplan.js"

step "Qualitätsstufen (web/quality.js, Node-Test)"
node tools/test-quality.js || bad "tools/test-quality.js"

step "Bibliothek-Scan (web/library.js, Node-Test)"
node tools/test-library.js || bad "tools/test-library.js"

step "Release-Text aus dem CHANGELOG (tools/release-notes.sh)"
V="$(sed -n 's/.*Base = "\([^"]*\)".*/\1/p' internal/version/version.go)"
sh tools/release-notes.sh "$V" > /tmp/p5c-notes.md 2>&1 && grep -q "^### $V " /tmp/p5c-notes.md && grep -q "^\*\*Downloads:\*\*" /tmp/p5c-notes.md || bad "tools/release-notes.sh liefert für $V keinen Abschnitt"

step "web/embed.go: jede Datei aus index.html ist eingebettet und vorhanden"
for f in $(grep -o 'src="[a-z0-9.-]*\.js"' web/index.html | sed 's/src="//;s/"//'); do
  [ -f "web/$f" ] || bad "web/$f fehlt"
  grep -q "$f" web/embed.go || bad "$f steht in index.html, aber nicht in web/embed.go"
done
for f in $(sed -n 's#^//go:embed ##p' web/embed.go | tr ' ' '\n'); do [ -f "web/$f" ] || bad "web/embed.go nennt $f, Datei fehlt"; done

step "Versionsstellen einheitlich (version.go, CHANGELOG, news.json)"
V=$(sed -n 's/^const Base = "\(.*\)"/\1/p' internal/version/version.go)
C=$(sed -n 's/^## \([0-9][0-9.]*\) .*/\1/p' CHANGELOG.md | head -1)
N=$(python3 -c 'import json;print(json.load(open("internal/server/news.json",encoding="utf-8"))[0]["version"])')
echo "version.go=$V CHANGELOG=$C news.json=$N"
[ "$V" = "$C" ] || bad "CHANGELOG oben ($C) passt nicht zu version.go ($V)"
[ "$V" = "$N" ] || bad "erster Eintrag in news.json ($N) passt nicht zu version.go ($V)"
python3 -c 'import json;json.load(open("internal/server/news.json",encoding="utf-8"))' || bad "news.json ist kein gültiges JSON"

step "Workflow-Datei (YAML) und Skripte (Syntax)"
python3 - <<'PY' || bad "build.yml ist kein gültiges YAML"
import sys
try:
    import yaml
except ImportError:
    print("(PyYAML fehlt – übersprungen)"); sys.exit(0)
yaml.safe_load(open(".github/workflows/build.yml", encoding="utf-8"))
PY
sh -n .github/smoke.sh || bad "smoke.sh Syntax"
if command -v pwsh >/dev/null 2>&1; then
  for f in windows/*.ps1; do pwsh -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('$f',[ref]\$null,[ref]\$e); if (\$e) { \$e; exit 1 }" || bad "PowerShell-Syntax $f"; done
else echo "(pwsh nicht installiert – PowerShell-Skripte nicht geprüft)"; fi

if [ "$1" != "quick" ]; then
  step "go test -race ./... (braucht ffmpeg)"
  go test -race ./... || bad "go test"
fi

echo
if [ $FAIL -eq 0 ]; then echo "Vorprüfung bestanden."; else echo "Vorprüfung NICHT bestanden – nicht pushen."; fi
exit $FAIL
