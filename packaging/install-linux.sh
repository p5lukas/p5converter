#!/bin/sh
# Installiert p5converter für den aktuellen Benutzer (Fedora KDE & Co.).
set -e
dir=$(dirname "$0")
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
install -m755 "$dir/p5converter" "$HOME/.local/bin/p5converter"
install -m644 "$dir/p5converter.desktop" "$HOME/.local/share/applications/p5converter.desktop"
echo "Installiert. Start über das Anwendungsmenü oder: p5converter"
echo "Fedora: ffmpeg mit x264/x265/QSV braucht RPM Fusion (siehe README)."
