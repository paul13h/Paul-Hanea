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
