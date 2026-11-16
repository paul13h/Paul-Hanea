#!/bin/bash
# Render the fixed ground-truth frames with ghost=1 and build one contact sheet (real clip | ghost render).
#   tools/check.sh [--root DIR] [--query "k=v&k2=v2"] [--name NAME]
# Data (frames, landmark dumps, runs, sheets) lives outside the repo in $TRYON_DATA
# (default ~/Documents/Virtual Try-On/tryon-data). Frames and dumps are cached; reruns only re-render.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"; QUERY=""; NAME=""
while [ $# -gt 0 ]; do case "$1" in
  --root) ROOT="$(cd "$2" && pwd)"; shift 2;; --query) QUERY="$2"; shift 2;; --name) NAME="$2"; shift 2;;
  *) echo "unknown option $1"; exit 1;; esac; done
export ROOT
DATA="${TRYON_DATA:-$HOME/Documents/Virtual Try-On/tryon-data}"
A="$HOME/Downloads/tryon-test/IMG_1402_small.mp4"; B="$HOME/Downloads/tryon-test/IMG_1405_small.mp4"
FL="$HOME/Documents/Movie on 07-11-2026 at 17.10.mov"
[ -n "$NAME" ] || NAME="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD | tr '/' '_')-$(git -C "$ROOT" rev-parse --short HEAD)"
mkdir -p "$DATA/sheets" "$DATA/runs"
# Frame numbering: 0-based. File NNNN.jpg = frame N (ffmpeg -start_number 0). imix = IMG_1402 frames 0..261, then IMG_1405 frame 0 = imix 262.
VF='crop=720:720:0:280,pad=1080:720:180:0,scale=960:640'
if [ ! -f "$DATA/imix/0789.jpg" ]; then
  echo "extracting imix frames"; mkdir -p "$DATA/imix"
  ffmpeg -v error -y -i "$A" -vf "$VF" -frames:v 262 -start_number 0 -q:v 3 "$DATA/imix/%04d.jpg"
  ffmpeg -v error -y -i "$B" -vf "$VF" -start_number 262 -q:v 3 "$DATA/imix/%04d.jpg"
fi
if [ ! -f "$DATA/fl/0600.jpg" ]; then
  echo "extracting fl frames"; mkdir -p "$DATA/fl"
  ffmpeg -v error -y -i "$FL" -vf scale=960:640 -start_number 0 -q:v 3 "$DATA/fl/%04d.jpg"
fi
[ -f "$DATA/L_imix.json" ] || { echo "FaceMesh dump imix"; python3 "$HERE/dump_l.py" "$DATA" imix 8810; }
[ -f "$DATA/L_fl.json" ] || { echo "FaceMesh dump fl"; python3 "$HERE/dump_l.py" "$DATA" fl 8811; }
Q="frame=tf&ghost=1"; [ -z "$QUERY" ] || Q="$Q&$QUERY"
rm -rf "$DATA/runs/$NAME"; mkdir -p "$DATA/runs/$NAME"
ONLY=342,420,452,466,471,472,476,495,496,498,502,642,712,742 python3 "$HERE/run_r.py" "$DATA" imix "runs/$NAME/imix" scan "$Q&fov=43" 8812 1 > "$DATA/runs/$NAME/imix.log" 2>&1 &
P1=$!
ONLY=500,515,545 python3 "$HERE/run_r.py" "$DATA" fl "runs/$NAME/fl" scan "$Q&fov=46" 8813 1 > "$DATA/runs/$NAME/fl.log" 2>&1 &
P2=$!
wait $P1 $P2 || { tail -5 "$DATA/runs/$NAME/"*.log; exit 1; }
python3 "$HERE/sheet.py" "$DATA" "runs/$NAME/imix" "runs/$NAME/fl" "$DATA/sheets/$NAME.jpg" "$NAME  root=$ROOT  query=$Q"
tail -qn1 "$DATA/runs/$NAME/"*.log | cut -c1-200
echo "run JSONs: $DATA/runs/$NAME/{imix,fl}.json"
echo "SHEET: $DATA/sheets/$NAME.jpg"
