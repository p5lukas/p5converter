#!/bin/sh
# Smoke test of the built image: starts it like Unraid would (non-root PUID/PGID), runs real conversions.
set -eu
IMG=$1
M=$(mktemp -d); O=$(mktemp -d); chmod 755 "$M"; chmod 777 "$O"
docker run --rm -v "$M:/media" --entrypoint ffmpeg "$IMG" -v error -f lavfi -i testsrc2=s=640x360:r=25:d=3 -f lavfi -i sine=d=3 \
  -c:v libx264 -c:a aac /media/test.mkv
docker run --rm -v "$M:/media" --entrypoint ffmpeg "$IMG" -v error -f lavfi -i sine=d=3 -metadata artist=Band -metadata title=Lied /media/song.flac
docker run --rm -v "$M:/media" --entrypoint chmod "$IMG" 644 /media/test.mkv /media/song.flac
trap 'docker logs p5smoke 2>&1 | tail -30; docker rm -f p5smoke >/dev/null 2>&1 || true' EXIT
docker run -d --name p5smoke -p 8787:8787 -v "$M:/media:ro" -v "$O:/output" "$IMG" >/dev/null

for i in $(seq 1 30); do curl -fs localhost:8787/api/info >/dev/null && break; sleep 1; done
curl -fs localhost:8787/api/info >/dev/null || { echo "Server startet nicht"; exit 1; }
for i in $(seq 1 60); do
  curl -fs localhost:8787/api/info | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["hw"]["done"] else 1)' && break; sleep 1
done
curl -fs localhost:8787/api/info | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("ffmpeg:", d["ffmpeg"][:40])
for b in d["hw"]["backends"]:
    print(" ", b["id"], sorted(b["codecs"]), (b.get("detail") or "")[:100])
assert d["hw"]["backends"][0]["codecs"].get("hevc"), "CPU-HEVC fehlt"
'
# Version, Neuigkeiten, Web-App-Manifest und Oberfläche
curl -fs localhost:8787/api/info | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["version"].startswith(d["build"]["base"]), d["version"]
print("Version:", d["version"])'
curl -fs localhost:8787/api/news | python3 -c 'import json,sys; n=json.load(sys.stdin); assert len(n)>0 and n[0]["version"]'
curl -fs localhost:8787/manifest.webmanifest | python3 -c 'import json,sys; assert json.load(sys.stdin)["display"]=="standalone"'
curl -fs -o /dev/null localhost:8787/icon-192.png && curl -fs localhost:8787/ | grep -q "p5converter" || { echo "Oberfläche/Icons fehlen"; exit 1; }
H='Content-Type: application/json'
curl -fs -X POST -H "$H" localhost:8787/api/jobs -d '{"kind":"video","items":[{"path":"/media/test.mkv"}],"output":{"dir":"/output","exists":"rename"},"video":{"container":"mkv","codec":"hevc","backend":"cpu","crf":30,"preset":"veryfast","bitDepth":10,"height":180,"audioMode":"copy","subMode":"copy"}}'
curl -fs -X POST -H "$H" localhost:8787/api/jobs -d '{"kind":"audio","items":[{"path":"/media/song.flac"}],"output":{"dir":"/output","pattern":"{artist}/{title}"},"audio":{"format":"mp3","mode":"vbr","quality":2}}'
echo
for i in $(seq 1 90); do
  curl -fs localhost:8787/api/state | python3 -c '
import json,sys
j=json.load(sys.stdin)["jobs"]
sys.exit(0 if j and all(x["status"] not in ("queued","running") for x in j) else 1)' && break
  sleep 1
done
curl -fs localhost:8787/api/state | python3 -c '
import json,sys
for j in json.load(sys.stdin)["jobs"]:
    print(j["kind"], j["status"], j["encoder"], "confirmed=%s" % j["encoderConfirmed"], j["output"], j.get("error",""))
    assert j["status"]=="done", "Job fehlgeschlagen"
'
test -s "$O/test.mkv" && test -s "$O/Band/Lied.mp3" || { echo "Ausgabedateien fehlen"; ls -R "$O"; exit 1; }
[ "$(stat -c %u "$O/test.mkv")" = "99" ] || { echo "Dateien gehören nicht PUID 99"; exit 1; }
docker run --rm -v "$O:/output:ro" --entrypoint ffprobe "$IMG" -v error -show_entries stream=codec_name,pix_fmt,height -of csv /output/test.mkv
# CSRF protection active
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' localhost:8787/api/jobs/cancel-all -d '{}')
[ "$code" = "415" ] || { echo "CSRF-Schutz fehlt ($code)"; exit 1; }
# healthcheck binary works inside container
docker exec p5smoke p5converter -healthcheck
echo "SMOKE OK"
