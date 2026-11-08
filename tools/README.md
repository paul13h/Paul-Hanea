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
