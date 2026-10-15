#!/bin/sh
# p5converter – Installation für Linux (Fedora KDE & Co.). ffmpeg ist enthalten.
set -e
here=$(cd "$(dirname "$0")" && pwd)
src="$here/app"
dest="$HOME/.local/opt/p5converter"

echo "=== p5converter installieren ==="
mkdir -p "$dest" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/scalable/apps"
# laufende Instanz beenden, damit Dateien ersetzt werden können
pkill -x p5converter 2>/dev/null || true
sleep 1
for f in p5converter ffmpeg ffprobe; do install -m755 "$src/$f" "$dest/$f"; done
cp -f "$src/ffmpeg-info.txt" "$src/LICENSE-p5converter.txt" "$src/Deinstallieren.sh" "$dest/" 2>/dev/null || true
ln -sf "$dest/p5converter" "$HOME/.local/bin/p5converter"
cp -f "$src/p5converter.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/p5converter.svg"
sed "s|@APP@|$dest|" "$src/p5converter.desktop" > "$HOME/.local/share/applications/p5converter.desktop"
chmod +x "$HOME/.local/share/applications/p5converter.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 >/dev/null 2>&1 || true

# --- Intel-GPU: Quick-Sync-Treiber (nur auf Wunsch) ---
intel=0
for v in /sys/class/drm/card*/device/vendor; do
  [ -r "$v" ] && [ "$(cat "$v")" = "0x8086" ] && intel=1
done
if [ "$intel" = 1 ] && command -v dnf >/dev/null 2>&1 && [ -t 0 ]; then
  if ! rpm -q intel-media-driver >/dev/null 2>&1 || ! rpm -q libvpl >/dev/null 2>&1; then
    echo
    echo "Intel-GPU erkannt. Für Quick Sync fehlen Treiberpakete (intel-media-driver, libvpl)."
    printf "Jetzt per dnf installieren (sudo-Passwort nötig)? [j/N] "
    read -r a || a=n
    case "$a" in
      j|J|y|Y)
        if ! dnf repolist 2>/dev/null | grep -qi rpmfusion-free; then
          echo "-> aktiviere RPM Fusion (free)"
          sudo dnf install -y "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" || true
        fi
        sudo dnf install -y intel-media-driver libvpl libva-utils \
          || echo "Hinweis: Treiber-Installation fehlgeschlagen – Quick Sync ist dann evtl. nicht verfügbar (CPU geht trotzdem)."
        ;;
    esac
  fi
fi

echo
echo "FERTIG. p5converter findest du jetzt im Anwendungsmenü (Kategorie Multimedia)."
echo "Zum Beenden: oben rechts im Programm auf \"Beenden\" klicken."
echo "NVIDIA-Grafikkarte: den proprietären NVIDIA-Treiber installieren (RPM Fusion: akmod-nvidia), dann geht NVENC."
echo "Log bei Problemen: ~/.cache/p5converter/p5converter.log"
if [ -n "$DISPLAY$WAYLAND_DISPLAY" ]; then
  echo "Starte p5converter ..."
  nohup "$dest/p5converter" >/dev/null 2>&1 &
fi
