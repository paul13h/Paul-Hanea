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
