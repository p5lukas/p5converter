> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. `main`, Tag und Release macht der Nutzer bzw. nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] **Port 8787** als Standard (umgesetzt in PR #3, wartet auf „leg los“ zum Mergen)
- [ ] **Designlinie wie p5assets** (Referenz im Repo `p5lukas/p5assets`: `app/static/style.css`, `planets.js`, `index.html`):
  - Matrix-Theme: dunkler Grund, Monospace-Schrift, Leuchteffekte (Glow), Labels mit `> `-Präfix, kantige 6-px-Rundungen
  - gesamte Palette aus **einem Farbton `--h`** abgeleitet; jede „Welt“ hat ihre eigene Akzentfarbe
  - **Welten-Umschalter Audio / Video** im Kopf (wie bei p5assets mit Planeten-Symbolen), Logo mit blinkendem Cursor
  - Toasts, Drop-Zone/Dateiauswahl, Onboarding/Schritte falls sinnvoll
  - Handy/iPad: Web-App-Fähigkeit (manifest, apple-touch-icon, Safe-Areas), eigene Mobilansichten
  - ⓘ-Hilfetexte im neuen Stil beibehalten
- [ ] **Branch- und Image-Modell wie p5assets**: Feature-Branch → `dev` (Image `:dev`) → `main` (Image `:latest`), Tag `v…` → Versions-Image; Version/Branch/Commit im Footer anzeigen; optional multi-arch (amd64/arm64)
- [ ] **Versionierung wie p5assets**: Versionsdatei, `CHANGELOG.md`, „Neuigkeiten“-Anzeige in der Oberfläche
- [ ] Zu klären: Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie echte Welt“) sinngemäß übernehmen? (z. B. Warteschlange mit 500 Dateien)

## Vom Nutzer zu prüfen (nicht in der Sandbox möglich)
- [ ] GPU-Encoding auf echter Hardware (Intel Quick Sync via `/dev/dri`, NVIDIA via `--runtime=nvidia`)
- [ ] ghcr-Paket `p5converter` auf öffentlich stellen (sonst kann Unraid das Image nicht ziehen)

## Später
- [ ] Windows-App mit eigener Oberfläche
- [ ] Linux-App (Fedora KDE) mit eigener Oberfläche

## Erledigt
- [x] v0.0.1 als Pre-Release (Docker-Image + Unraid-Template)
