> Arbeitsregel (Nutzer): Bei „Todo: …“ nur hier eintragen und als Commit `TODO: …` festhalten, nichts umsetzen. Bei „leg los“ alle offenen Punkte umsetzen.
> Arbeitsregel (Nutzer): Bei jedem „leg los“ einen kleinen Versionssprung machen (Patch, z. B. 0.0.1 → 0.0.2), neuen Abschnitt oben in `CHANGELOG.md` anlegen (Datum, Neu/Geändert/Behoben), alles testen und auf Feature-Branch (und später `dev`) pushen. `main`, Tag und Release macht der Nutzer bzw. nur auf ausdrücklichen Wunsch (Tags kann ich nicht pushen).
> Tags/Releases (Nutzer): nur bei Sprüngen der mittleren Stelle (0.1.0 → 0.2.0 → …), nicht bei Patch-Versionen.
> Prüfregel (Nutzer): Bei jeder UI-Änderung immer **alle Ansichten** kontrollieren: Desktop, iPhone/iPad im Browser (Safari) und iPhone/iPad als Web-App (Home-Bildschirm), Hoch- und Querformat. Sandbox hat nur Chromium: Geräte-Emulation + Screenshots; Nicht-Prüfbares im Bericht als „nicht geprüft“ nennen.
> Entscheidung (Nutzer): Die Test-Last-Regel von p5assets („Testumgebung doppelt so groß wie die echte Welt“) gilt hier **nicht**.
> Entscheidung (Nutzer): Erst Unraid/Docker mit „mega Design“, dann Windows-App mit eigener GUI, dann Linux-App (Fedora KDE) mit eigener GUI.

# p5converter – Ideen & Verbesserungen

## Offen
- [ ] **QSV wird auf Unraid nicht erkannt** (Nutzer: Intel Core i9-9900 = UHD 630, Coffee Lake / 9. Gen; Quick Sync funktioniert dort z. B. in HandBrake). Vermutungen, noch nicht bestätigt:
  1. Das Image enthält nur die neue Intel-Runtime (`libvpl2` + `libmfx-gen1.2`, gedacht für Gen 12+); für ältere Chips (bis Gen 11, also auch Coffee Lake) fehlt die **Media-SDK-Runtime `libmfx1`** (in Ubuntu 24.04 vorhanden, Version 22.5.4) – ffmpeg findet dann keine MFX-Sitzung
  2. **VAAPI** (Treiber `iHD`) sollte auf dem i9-9900 trotzdem gehen – prüfen, ob die Hardware-Karte „VAAPI“ als nutzbar zeigt; dann wäre es ein Zwischenweg
  3. **`/dev/dri` kommt evtl. gar nicht im Container an**: Nutzer musste bei HandBrake in Unraid einen eigenen Eintrag *Config Type: Device, Name/Value `/dev/dri`* anlegen (Screenshot). Unser Template setzt das nur über `<ExtraParams>--device=/dev/dri</ExtraParams>` – das ist unsichtbar und wird bei manuell angelegten/geänderten Containern leicht nicht übernommen. Fix-Idee: im Template zusätzlich einen sichtbaren `<Config Type="Device" Target="/dev/dri" …>`-Eintrag (wie bei HandBrake) setzen, ExtraParams nur noch für `--runtime=nvidia`/Hinweise; README/Release-Text anpassen
  4. Rechte auf `/dev/dri` bei `PUID`/`PGID` 99/100 (Gruppen werden im Entrypoint übernommen) – ausschließen
  - Vom Nutzer nötig: Text unter „Intel Quick Sync (QSV)“ und „VAAPI“ in der Karte „Hardware“ sowie die Ausgabe von `ls -l /dev/dri` im Container
  - Idee: Erkennung probiert beide Intel-Runtimes, bessere Fehlermeldung für Quick Sync, Test mit `-init_hw_device`
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
