# Arbeitsweise im Projekt p5converter

Gleiche Zusammenarbeit wie im Schwesterprojekt **p5assets** (Vorbild: `TODO.md` dort). Sprache: Deutsch, kurz und ehrlich berichten.

## Ablauf
- **„Todo: …“** vom Nutzer = nur notieren: Eintrag in `TODO.md` + eigener Commit `TODO: <kurzer Text>`. **Nichts umsetzen.**
- Bei offenen Entscheidungen Varianten (A/B/C) mit kurzer Beschreibung vorschlagen; der Nutzer wählt kurz („Dann C“). Die Entscheidung wird als `TODO: … Variante C` festgehalten.
- **„Leg los“** = alle offenen TODOs umsetzen, danach kleiner Versionssprung (siehe unten). Ohne „leg los“ wird nichts gemergt, getaggt oder veröffentlicht.
- Regeln des Nutzers werden als „Arbeitsregel (Nutzer)“ in `TODO.md` oben festgehalten.

## Versionen und Veröffentlichung
- Bei jedem „leg los“ ein **Patch-Sprung** (0.0.1 → 0.0.2): Version hochsetzen, neuen Abschnitt oben in `CHANGELOG.md` (Datum; Neu/Geändert/Behoben), alles testen, auf Feature-Branch pushen.
- **Tags/Releases nur bei Sprüngen der mittleren Stelle** (0.1.0 → 0.2.0 …), nicht bei Patch-Versionen. Größere Funktionen = kleine Versionssprünge nur nach Absprache.
- `main`, Tag und Release macht der Nutzer bzw. nur auf ausdrücklichen Wunsch. **Tags kann ich aus der Sandbox nicht pushen**; Ausweg nur auf Wunsch: Workflow `build.yml` per `workflow_dispatch` mit Eingabe `version` (legt Tag + Pre-Release an).
- Aktueller Stand: `v0.0.1` ist ein **Pre-Release**.

## Prüfregel (bei jeder UI-Änderung)
Immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Die Sandbox hat nur Chromium (kein Safari/echtes iOS): geprüft wird mit Geräte-Emulation (iPhone ≈ 390×844, iPad ≈ 820×1180, Touch, `hover: none`) und Screenshots. Was sich so nicht prüfen lässt (Safe-Areas/Statusleiste in der Web-App, Pull-to-Refresh, iOS-Eigenheiten, **GPU-Encoding auf echter Hardware**), wird im Bericht ausdrücklich als „nicht geprüft“ genannt und vom Nutzer auf dem Gerät getestet.

## Qualität
- `go vet ./... && go test -race ./...` (benötigt ffmpeg); CI-Smoke-Test des Docker-Images (`.github/smoke.sh`) muss grün sein.
- Nichts als „fertig“ melden, was nicht ausgeführt wurde; ungetestete Pfade benennen.

## Projektstand und Reihenfolge (Entscheidung des Nutzers)
1. **Unraid/Docker** zuerst, stabil und mit gutem Design.
2. Danach **Windows-App** mit eigener Oberfläche, dann **Linux-App** (Fedora KDE) mit eigener Oberfläche.
3. **Designlinie wie p5assets** (siehe `TODO.md`).
4. Standard-Port **8787**.
