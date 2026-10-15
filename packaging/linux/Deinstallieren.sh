#!/bin/sh
pkill -x p5converter 2>/dev/null || true
rm -rf "$HOME/.local/opt/p5converter" "$HOME/.local/bin/p5converter" \
  "$HOME/.local/share/applications/p5converter.desktop" \
  "$HOME/.local/share/icons/hicolor/scalable/apps/p5converter.svg"
echo "p5converter entfernt."
