> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. `main`, Tag und Release macht der Nutzer bzw. nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Die Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie die echte Welt“) gilt hier **nicht**.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] Branch-Modell: **erstmal nur `main`**, bis alles stabil läuft. Auf Zuruf des Nutzers dann wie p5assets: Feature-Branch → `dev` (Image `:dev`) → `main` (Image `:latest`); optional multi-arch (amd64/arm64)
- [ ] Design weiter verfeinern nach Rückmeldung vom Gerät (iPhone/iPad Safari und Web-App)

## Vom Nutzer zu prüfen (nicht in der Sandbox möglich)
- [ ] iPhone/iPad: Safari und Web-App (Safe-Areas, Statusleiste, Pull-to-Refresh) auf dem Gerät ansehen
- [ ] GPU-Encoding auf echter Hardware (Intel Quick Sync via `/dev/dri`, NVIDIA via `--runtime=nvidia`)

## Später
- [ ] Windows-App mit eigener Oberfläche
- [ ] Linux-App (Fedora KDE) mit eigener Oberfläche

## Erledigt
- [x] 0.0.2: Port 8787, Designlinie wie p5assets (Matrix-Theme, Welten mit Planeten, Übersicht, Handy/iPad, Web-App), Versionierung (Version, CHANGELOG, Neuigkeiten, Fußzeile)
- [x] ghcr-Paket ist öffentlich (geprüft)
- [x] v0.0.1 als Pre-Release (Docker-Image + Unraid-Template)
