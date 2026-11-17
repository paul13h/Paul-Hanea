# Test tools for the v2 try-on

These scripts feed recorded video frames into the real page (headless Chromium + Playwright, software WebGL)
frame by frame and save what the page renders. Nothing here is served to customers.

Frames are not in the repo (they show a real face). Make them from a video:

    mkdir -p real/fl && ffmpeg -i Movie.mov -vf scale=960:640 -q:v 3 real/fl/%04d.jpg

Render a clip (outputs real/<out>/NNNN.jpg plus real/<out>.json with pose, yaw and fit per frame):

    python3 tools/run_l.py <dir-with-clips> <clip> <out> [scan|noscan] "frame=tf" <port>

`run_l.py` serves the repo root (it expects the repo at /home/claude/paul-hanea; change `cwd=` if not).
Query params pass through, e.g. `frame=tf` (Tom Ford), `ghost=1` (red see-through frame over real glasses).
The output frames are mirrored back for comparison with the selfie view: flip them horizontally to match the page.

Other scripts: `dump*.py` save FaceMesh landmarks per frame, `off.mjs`, `slide.mjs`, `yaw.mjs` evaluate
tracking offline (bridge slide in px, lag, yaw error) from those dumps.

## Faster: save landmarks once, replay them (v13)

    python3 tools/dump_l.py real fl 8800                     # FaceMesh once per clip -> real/L_fl.json
    python3 tools/run_r.py real fl out scan "frame=tf" 8801 5  # replay; saves every 5th frame

`run_r.py` skips FaceMesh, so a whole clip renders in 2-3 minutes and every version sees the same landmarks.
Its JSON also records the projected lens centres (`lens`) and pupils per frame.
`replay.mjs` is the page's scan + tracking in Node, for checking tracking maths without rendering.

**Ground truth with the real frame on:** do the face scan on a clip *without* glasses (glasses on change the scan),
then judge the ghost on the clip *with* the real frame. Concatenate frames and landmarks into one clip:
first ~260 frames of the no-glasses clip, then the real-frame clip (see the v13 commit for the exact steps).
Judge the ghost overlay by eye on looking up, looking down, straight and 3/4 frames.
Automatic "overlap with dark pixels" scores were tried and are biased (a bigger frame always scores better), so don't trust them.

## v19: does the virtual frame stay on the face? (real frame as ground truth)

Paul's laptop clips of 9 Nov: `Movie on 09-11-2026 at 14.03.mov` (no glasses, same moves) and `... 13.59.mov` (wearing the
real Tom Ford). Frames `scale=960:640` -> `real/k0`, `real/k1`; landmarks with `dump_l.py`. `kmix` = all of k0 (the scan
finishes at frame 376) followed by all of k1, so k1 frames are kmix 394 onwards.

    FROM=394 python3 tools/run_r.py real kmix gX scan "frame=tf&ghost=1" 8801 1   # FROM: only save frames from 394 on
    python3 tools/align.py real kmix gX            # per frame: shift that lays the red ghost on the real frame
    python3 tools/cmp.py real kmix gX out.jpg 120 -60 gX other -- 403 438   # crops: original | renders (mirrored like the page)

`align.py` compares the virtual front with the dark pixels of the real frame. The shift itself has an offset (the frame sits
2 mm low by design); what matters is how it changes with yaw and pitch, i.e. how much the glasses slide on the face when
the head moves. The real arms near the corner can pull the result in 3/4 views. It does not work on the iPhone clip (padding,
lighting). `SCALE=2` renders at 2x (MacBook size); cmp.py then needs a 1x render's JSON for the crop positions.

## check.sh: one contact sheet of the ground-truth frames

    tools/check.sh [--root DIR] [--query "k=v&k2=v2"] [--name NAME]

Renders the fixed ground-truth frames with `frame=tf&ghost=1` and writes one JPG: per row the real clip crop | ghost
render crop (mirrored like the page). Frames: imix (fov 43) front up 466/471/476, down 495/498/502, straight 452/742,
3/4 642/712; arm ear ends 342/420 (turned), 472 (up), 496 (down); laptop `fl` (fov 46, no real frame) 500/515/545.
- `--root`: repo/worktree whose `v2/` is served (default: repo of the script), e.g. the stability worktree.
- `--query`: extra params appended. `--name`: output name (default `<branch>-<short hash>`).
- Data lives outside the repo in `$TRYON_DATA` (default `~/Documents/Virtual Try-On/tryon-data`): `imix/`, `fl/` frames,
  `L_imix.json`, `L_fl.json` landmark dumps (cached, made only if missing), `runs/NAME/{imix,fl}.json` (per-frame `rec` for
  numbers), `sheets/NAME.jpg`. Sources: `~/Downloads/tryon-test/IMG_1402_small.mp4`, `IMG_1405_small.mp4`, the 7 Nov laptop mov.
- Numbering is 0-based (`ffmpeg -start_number 0`, file `NNNN.jpg` = frame N). imix 0..261 = IMG_1402 0..261 (scan),
  imix 262.. = IMG_1405 from frame 0. Tracking runs on all frames; only the listed ones are saved (`ONLY=` env of `run_r.py`).
- `run_r.py`/`dump_l.py` honour env `ROOT` (repo to serve). First run ~2.5 min (extraction + FaceMesh dumps), reruns ~1 min.
- `sheet.py` builds the sheet; arm crops shift towards the near ear using nose-tip vs bridge offset.

### check.sh: kmix, before/after sheets, summary, ports, skipped frames (tested end to end 17 Nov, ~3 min per run with 3 clips in parallel)

    tools/check.sh --root DIR [--query Q] [--name N]                              one run -> sheets/N.jpg (real | ghost)
    tools/check.sh --root A --query QA --name NA --root2 B --query2 QB --name NB   two runs -> sheets/NA-vs-NB.jpg (real | A | B)
    tools/check.sh --compare NA NB                                                no rendering, reuse two earlier runs
    --only imix,fl,kmix   clips to render      --nobottom   skip bottom-edge numbers (renders ~170 fewer frames)
    --port 8840           first port; A uses PB..PB+2 (imix, fl, kmix), B PB+3..PB+5, FaceMesh dumps PB+6..PB+8 (or env CHECK_PORT)

- `kmix` (laptop, 9 Nov; no glasses 0..393 = scan, real Tom Ford from 394; fov 46) adds 15 rows: straight 403/428, turned 464/576/584/840,
  arms 486/495/592/784, down 664/668/672, up 712/720. Frames come from the two 9 Nov movies in ~/Downloads.
- Printed summary (`bottom.py`): bottom rim edge of both lenses, ghost minus real in mm (+ = ghost lower), median/IQR per pitch bin,
  straight-on frames only (|yaw| < 12), imix and kmix. Reference main f40d39b: imix median +3.5 mm, kmix -0.7 mm.
  Also written to `runs/NAME/bottom_{imix,kmix}.json`.
- `sheets/NAME-ruler.png` (`ruler.py`): kmix 403/428/664/668/672/720, left lens, real | ghost(s), lines every 5 mm (yellow 0, cyan +-20).
- Unreadable frames: iCloud evicts files from ~/Documents (reading blocks, ~1 file/s). `check.sh` re-extracts a clip from its video if
  `frames.py` finds evicted frames (stat flag; follows symlinks, so a `~/tryon-local` copy is untouched). If a frame is still
  unreadable, `run_r.py`/`dump_l.py` feed the nearest good image with no face, never save it, list it as `bad` in the run JSON, and
  `sheet.py`/`bottom.py`/`ruler.py` print which cells/frames were skipped (a red "missing/unreadable" cell in the sheet).
- Disk is tight: a run's saved frames are ~170 extra jpgs per clip for the bottom numbers; delete old `runs/*` dirs when done.
