# Arbeitsweise im Projekt p5converter

Gleiche Zusammenarbeit wie im Schwesterprojekt **p5assets** (Vorbild: `TODO.md` dort). Sprache: Deutsch, kurz und ehrlich berichten.

## Ablauf
- **„Todo: …“** vom Nutzer = nur notieren: Eintrag in `TODO.md` + eigener Commit `TODO: <kurzer Text>`. **Nichts umsetzen.**
- Bei offenen Entscheidungen Varianten (A/B/C) mit kurzer Beschreibung vorschlagen; der Nutzer wählt kurz („Dann C“). Die Entscheidung wird als `TODO: … Variante C` festgehalten.
- **„Leg los“** = alle offenen TODOs umsetzen, danach kleiner Versionssprung (siehe unten), Feature-Branch pushen, **Pull Request nach `dev`, grüne CI abwarten, Squash-Merge nach `dev`** (Image `:dev`; der Nutzer testet zuerst auf `dev`). **Nach `main` wird nur auf ausdrückliches Kommando des Nutzers gemergt** („passt so, nach main“): Pull Request `dev` → `main`, grüne CI abwarten, **normaler Merge-Commit** (kein Squash, damit `dev` und `main` nicht auseinanderlaufen). Ohne Freigabe wird nichts nach `main` gemergt, getaggt oder veröffentlicht.
- **Windows-App**: die `p5converter-setup.exe` hängt (Entscheidung des Nutzers 19.10., geändert 28.10.) **an jedem Release** `vX.Y.Z` (main); zwischendurch liegt der aktuelle dev-Stand in `dev-latest`. **Eine Version, ein Release** (wie bei p5assets): keine `vX.Y.Z-dev`-Releases mehr; der Release-Text kommt aus dem `CHANGELOG.md` (`tools/release-notes.sh`).
- CI-/Image-Stand (grün, `:latest` gebaut) meldet der Nutzer sich selbst unter GitHub → Actions; **nicht von selbst berichten** (vor dem Merge die CI abzuwarten bleibt Pflicht).
- Regeln des Nutzers werden als „Arbeitsregel (Nutzer)“ in `TODO.md` oben festgehalten.

## Versionen und Veröffentlichung
- Bei jedem „leg los“ ein **Patch-Sprung** (0.0.1 → 0.0.2): Version hochsetzen, neuen Abschnitt oben in `CHANGELOG.md` (Datum; Neu/Geändert/Behoben), alles testen, auf Feature-Branch pushen.
- **Tags/Releases nur bei Sprüngen der mittleren Stelle** (0.1.0 → 0.2.0 …), nicht bei Patch-Versionen. Größere Funktionen = kleine Versionssprünge nur nach Absprache.
- **Tag und Release nur auf ausdrücklichen Wunsch** bzw. bei Sprüngen der mittleren Stelle (ein Pre-Release `vX.Y.Z` von `main`, solange die Version mit 0. beginnt). **Tags kann ich aus der Sandbox nicht pushen**; Ausweg nur auf Wunsch: Workflow `build.yml` per `workflow_dispatch` mit Eingabe `version` (legt Tag + Pre-Release an).
- Aktueller Stand: Version 0.3.7 (Patch-Sprung, kein Tag/Release; auf `dev` und `main`). Letzter Sprung der mittleren Stelle: 0.3.0 (Pre-Release `v0.3.0`, die Windows-exe hängt daran). Vorher: `v0.2.0`, `v0.1.0` (Pre-Releases). Die `-dev`-Releases sind gelöscht; `tidy-releases` (nur von Hand, mit Bestätigung) schreibt Release-Texte neu. Nächster Tag erst beim nächsten Sprung der mittleren Stelle oder auf Wunsch.

## Prüfregel (bei jeder UI-Änderung)
Immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Die Sandbox hat nur Chromium (kein Safari/echtes iOS): geprüft wird mit Geräte-Emulation (iPhone ≈ 390×844, iPad ≈ 820×1180, Touch, `hover: none`) und Screenshots. Was sich so nicht prüfen lässt (Safe-Areas/Statusleiste in der Web-App, Pull-to-Refresh, iOS-Eigenheiten, **GPU-Encoding auf echter Hardware**), wird im Bericht ausdrücklich als „nicht geprüft“ genannt und vom Nutzer auf dem Gerät getestet.

## Qualität
- **Vor jedem Push `sh tools/precheck.sh`** (gofmt, `go vet`, Windows-Build `GOOS=windows CGO_ENABLED=0`, go.mod-Prüfung, JS-Syntax, eingebettete Dateien, Versionsstellen, `go test -race`); erst pushen, wenn sie besteht. Die CI soll nichts mehr finden, was lokal prüfbar war.
- `go vet ./... && go test -race ./...` (benötigt ffmpeg); CI-Smoke-Test des Docker-Images (`.github/smoke.sh`) muss grün sein.
- Nichts als „fertig“ melden, was nicht ausgeführt wurde; ungetestete Pfade benennen.

## Projektstand und Reihenfolge (Entscheidung des Nutzers)
1. **Unraid/Docker** zuerst, stabil und mit gutem Design.
2. Danach **Windows-App** mit eigener Oberfläche, dann **Linux-App** (Fedora KDE) mit eigener Oberfläche.
3. **Designlinie wie p5assets** (siehe `TODO.md`).
4. Standard-Port **8787**.
