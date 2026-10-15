#!/bin/sh
# Drop privileges to PUID/PGID (Unraid default 99:100) but keep access to GPU device nodes.
if [ "${PUID:-0}" = "0" ]; then exec "$@"; fi
GIDS=""
for d in /dev/dri/* /dev/nvidia* /dev/kfd; do
  [ -e "$d" ] && GIDS="$GIDS,$(stat -c %g "$d")"
done
GIDS=${GIDS#,}
if [ -n "$GIDS" ]; then
  exec setpriv --reuid="$PUID" --regid="$PGID" --groups="$GIDS" "$@"
else
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi
