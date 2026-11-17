#!/bin/bash
# Render the fixed ground-truth frames with ghost=1 and build one contact sheet (real clip | ghost render [| second ghost]).
#   tools/check.sh [--root DIR] [--query "k=v&k2=v2"] [--name NAME]          render DIR (default: this repo), build sheet
#   tools/check.sh --root DIR --query Q --root2 DIR2 [--query2 Q2] [--name N] [--name2 N2]   render both, sheet shows real | A | B
#   tools/check.sh --compare RUN_A RUN_B                                     no rendering: reuse two earlier runs (names under $TRYON_DATA/runs)
#   --only imix,fl,kmix   clips to render (default all three)   --nobottom  skip the bottom-edge measurement (renders fewer frames)
# Also prints a numeric summary: bottom-rim edge ghost-minus-real in mm per pitch bin (tools/bottom.py, straight-on frames only)
# and writes ruler crops (tools/ruler.py) of kmix 428/668 etc. Ports PB..PB+8, PB = --port or $CHECK_PORT (default 8840): A uses PB..PB+2, B PB+3..PB+5, dumps PB+6..PB+8.
# Data (frames, landmark dumps, runs, sheets) lives outside the repo in $TRYON_DATA
# (default ~/Documents/Virtual Try-On/tryon-data). Frames and dumps are cached; reruns only re-render.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"; QUERY=""; NAME=""; ROOT2=""; QUERY2=""; NAME2=""; CA=""; CB=""; CLIPS="imix,fl,kmix"; BOTTOM=1; PB="${CHECK_PORT:-8840}"
while [ $# -gt 0 ]; do case "$1" in
  --root) ROOT="$(cd "$2" && pwd)"; shift 2;; --query) QUERY="$2"; shift 2;; --name) NAME="$2"; shift 2;;
  --root2) ROOT2="$(cd "$2" && pwd)"; shift 2;; --query2) QUERY2="$2"; shift 2;; --name2) NAME2="$2"; shift 2;;
  --compare) CA="$2"; CB="$3"; shift 3;; --only) CLIPS="$2"; shift 2;; --port) PB="$2"; shift 2;; --nobottom) BOTTOM=0; shift;;
  *) echo "unknown option $1"; exit 1;; esac; done
DATA="${TRYON_DATA:-$HOME/Documents/Virtual Try-On/tryon-data}"
mkdir -p "$DATA/sheets" "$DATA/runs"
has() { case ",$CLIPS," in *",$1,"*) return 0;; esac; return 1; }
# Frame numbering: 0-based. File NNNN.jpg = frame N (ffmpeg -start_number 0).
prep() {
  local A="$HOME/Downloads/tryon-test/IMG_1402_small.mp4" B="$HOME/Downloads/tryon-test/IMG_1405_small.mp4"
  local FL="$HOME/Documents/Movie on 07-11-2026 at 17.10.mov"
  local K0="$HOME/Downloads/Movie on 09-11-2026 at 14.03.mov" K1="$HOME/Downloads/Movie on 09-11-2026 at 13.59.mov"
  local VF='crop=720:720:0:280,pad=1080:720:180:0,scale=960:640'   # imix = IMG_1402 frames 0..261, then IMG_1405 from 262
  # iCloud may evict frames from ~/Documents (reading them then blocks); re-extract any clip with evicted frames from its video
  ev() { [ "$(python3 "$HERE/frames.py" "$DATA/$1")" != 0 ]; }
  ev imix && { echo "imix frames evicted by iCloud, re-extracting"; rm -f "$DATA/imix/0789.jpg"; }
  ev fl && { echo "fl frames evicted by iCloud, re-extracting"; rm -f "$DATA/fl/0600.jpg"; }
  ev kmix && { echo "kmix frames evicted by iCloud, re-extracting"; rm -f "$DATA/kmix/0869.jpg"; }
  if [ ! -f "$DATA/imix/0789.jpg" ]; then
    echo "extracting imix frames"; mkdir -p "$DATA/imix"
    ffmpeg -v error -y -i "$A" -vf "$VF" -frames:v 262 -start_number 0 -q:v 3 "$DATA/imix/%04d.jpg"
    ffmpeg -v error -y -i "$B" -vf "$VF" -start_number 262 -q:v 3 "$DATA/imix/%04d.jpg"
  fi
  if [ ! -f "$DATA/fl/0600.jpg" ]; then
    echo "extracting fl frames"; mkdir -p "$DATA/fl"
    ffmpeg -v error -y -i "$FL" -vf scale=960:640 -start_number 0 -q:v 3 "$DATA/fl/%04d.jpg"
  fi
  if [ ! -f "$DATA/kmix/0869.jpg" ]; then   # kmix = 9 Nov no-glasses (394 frames, scan) then real Tom Ford (from 394)
    echo "extracting kmix frames"; mkdir -p "$DATA/kmix"
    ffmpeg -v error -y -i "$K0" -vf scale=960:640 -start_number 0 -q:v 3 "$DATA/kmix/%04d.jpg"
    ffmpeg -v error -y -i "$K1" -vf scale=960:640 -start_number 394 -q:v 3 "$DATA/kmix/%04d.jpg"
  fi
  local c p=$((PB+5))
  for c in imix fl kmix; do p=$((p+1)); has $c || continue
    [ -f "$DATA/L_$c.json" ] || { echo "FaceMesh dump $c"; python3 "$HERE/dump_l.py" "$DATA" $c $p; }
  done
}
# render NAME ROOT QUERY PORTBASE : the three clips in parallel
render() {
  local N="$1" R="$2" Q="frame=tf&ghost=1${3:+&$3}" P="$4"
  rm -rf "$DATA/runs/$N"; mkdir -p "$DATA/runs/$N"
  local IM=342,420,452,466,471,472,476,495,496,498,502,642,712,742 FLs=500,515,545
  local KM=403,428,464,486,495,576,584,592,664,668,672,712,720,784,840
  # extra frames for bottom.py: every 3rd real-glasses frame
  [ $BOTTOM = 1 ] && { IM="$IM,$(seq -s, 262 3 789)"; KM="$KM,$(seq -s, 394 3 869)"; }
  if has imix; then ROOT="$R" ONLY=$IM python3 "$HERE/run_r.py" "$DATA" imix "runs/$N/imix" scan "$Q&fov=43" $P 1 > "$DATA/runs/$N/imix.log" 2>&1 & PIDS="$PIDS $!"; fi
  if has fl;   then ROOT="$R" ONLY=$FLs python3 "$HERE/run_r.py" "$DATA" fl "runs/$N/fl" scan "$Q&fov=46" $((P+1)) 1 > "$DATA/runs/$N/fl.log" 2>&1 & PIDS="$PIDS $!"; fi
  if has kmix; then ROOT="$R" ONLY=$KM python3 "$HERE/run_r.py" "$DATA" kmix "runs/$N/kmix" scan "$Q&fov=46" $((P+2)) 1 > "$DATA/runs/$N/kmix.log" 2>&1 & PIDS="$PIDS $!"; fi
}
summary() {   # summary NAME... : bottom-edge numbers + ruler crops
  local N c
  if [ $BOTTOM = 1 ]; then
    for c in imix kmix; do has $c || continue
      local st=262; [ $c = kmix ] && st=394; local runs=""
      for N in "$@"; do runs="$runs runs/$N/$c"; done
      echo "== bottom rim edge, ghost minus real, mm (+ = ghost lower), $c, |yaw|<12 =="
      START=$st OUTJSON="$DATA/runs/$1/bottom_$c.json" python3 "$HERE/bottom.py" "$DATA" $c $runs
    done
  fi
  if has kmix; then
    local runs=""; for N in "$@"; do runs="$runs runs/$N/kmix"; done
    python3 "$HERE/ruler.py" "$DATA" kmix "$DATA/sheets/$1-ruler.png" $runs -- 403 428 664 668 672 720 && echo "RULER: $DATA/sheets/$1-ruler.png"
  fi
}
if [ -n "$CA" ]; then
  python3 "$HERE/sheet.py" "$DATA" "$DATA/sheets/$CA-vs-$CB.jpg" "$CA | $CB" "$CA" "$CB"
  summary "$CA" "$CB"; echo "SHEET: $DATA/sheets/$CA-vs-$CB.jpg"; exit 0
fi
nm() { echo "$(git -C "$1" rev-parse --abbrev-ref HEAD | tr '/' '_')-$(git -C "$1" rev-parse --short HEAD)"; }
[ -n "$NAME" ] || NAME="$(nm "$ROOT")"
[ -z "$ROOT2" ] || [ -n "$NAME2" ] || NAME2="$(nm "$ROOT2")"
[ "$NAME" != "$NAME2" ] || NAME2="$NAME2-b"
T0=$(date +%s); PIDS=""
prep
render "$NAME" "$ROOT" "$QUERY" $PB
[ -z "$ROOT2" ] || render "$NAME2" "$ROOT2" "$QUERY2" $((PB+3))
for p in $PIDS; do wait $p || { tail -5 "$DATA/runs/$NAME/"*.log; exit 1; }; done
tail -qn1 "$DATA/runs/$NAME/"*.log | cut -c1-200
if [ -n "$ROOT2" ]; then
  python3 "$HERE/sheet.py" "$DATA" "$DATA/sheets/$NAME-vs-$NAME2.jpg" "A=$NAME ($QUERY)  B=$NAME2 ($QUERY2)" "$NAME" "$NAME2"
  summary "$NAME" "$NAME2"; OUT="$DATA/sheets/$NAME-vs-$NAME2.jpg"
else
  python3 "$HERE/sheet.py" "$DATA" "$DATA/sheets/$NAME.jpg" "$NAME  root=$ROOT  query=frame=tf&ghost=1&$QUERY" "$NAME"
  summary "$NAME"; OUT="$DATA/sheets/$NAME.jpg"
fi
echo "run JSONs: $DATA/runs/$NAME/{imix,fl,kmix}.json   time $(( $(date +%s) - T0 )) s"
echo "SHEET: $OUT"
