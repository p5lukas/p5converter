#!/bin/sh
# p5converter Installer für Linux (Fedora KDE & Co.). ffmpeg ist im Paket enthalten.
# Optional installiert das Skript GPU-Treiberpakete (Intel Quick Sync / VAAPI) per dnf.
set -e
dir=$(cd "$(dirname "$0")" && pwd)
dest="$HOME/.local/opt/p5converter"

echo "==> Installiere nach $dest"
mkdir -p "$dest" "$HOME/.local/bin" "$HOME/.local/share/applications"
for f in p5converter ffmpeg ffprobe; do install -m755 "$dir/$f" "$dest/$f"; done
cp -f "$dir/ffmpeg-info.txt" "$dest/" 2>/dev/null || true
ln -sf "$dest/p5converter" "$HOME/.local/bin/p5converter"
sed "s|^Exec=.*|Exec=$dest/p5converter|" "$dir/p5converter.desktop" > "$HOME/.local/share/applications/p5converter.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

# --- GPU-Treiber (nur wenn nötig und gewünscht) ---
intel=0
for v in /sys/class/drm/card*/device/vendor; do
  [ -r "$v" ] && [ "$(cat "$v")" = "0x8086" ] && intel=1
done
if [ "$intel" = 1 ] && command -v dnf >/dev/null 2>&1; then
  if ! rpm -q intel-media-driver >/dev/null 2>&1 || ! rpm -q libvpl >/dev/null 2>&1; then
    echo
    echo "Intel-GPU gefunden. Für Quick Sync fehlen Treiberpakete (intel-media-driver, libvpl)."
    printf "Jetzt per dnf installieren (sudo nötig)? [j/N] "
    read -r a || a=n
    case "$a" in
      j|J|y|Y)
        if ! dnf repolist 2>/dev/null | grep -qi rpmfusion-free; then
          echo "==> Aktiviere RPM Fusion (free)"
          sudo dnf install -y "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" || true
        fi
        sudo dnf install -y intel-media-driver libvpl libva-utils || echo "Hinweis: Paket-Installation fehlgeschlagen – Quick Sync steht dann evtl. nicht zur Verfügung."
        ;;
    esac
  fi
fi

echo
echo "Fertig. Start über das Anwendungsmenü (\"p5converter\") oder im Terminal: p5converter"
echo "NVIDIA: den proprietären NVIDIA-Treiber (RPM Fusion: akmod-nvidia) installieren – NVENC ist dann automatisch verfügbar."
