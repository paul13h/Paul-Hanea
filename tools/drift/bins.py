# bins.py <data> <run...> : ghost-vs-real offset in mm per yaw/pitch bin (median, IQR), from <run>_drift.json
import sys, json, numpy as np
D = sys.argv[1]
BINS = [('straight 400-440', 400, 440), ('left 456-500', 456, 500), ('right 552-592', 552, 592), ('down 656-680', 656, 680), ('up 704-728', 704, 728), ('left2 768-792', 768, 792), ('right2 824-848', 824, 848)]
for g in sys.argv[2:]:
    d = {int(k): v for k, v in json.load(open(f'{D}/{g}_drift.json')).items()}
    rows = np.array([[i, v['yaw'], v['pitch'], v['all'][0] / v['pxmm'], v['all'][1] / v['pxmm'], v['all'][2], v['all'][3]] for i, v in sorted(d.items()) if v['all'][2] > .25])
    p0 = np.median(rows[(rows[:, 0] >= 400) & (rows[:, 0] <= 440), 2])
    print(f'== {g}: {len(rows)} frames with score>.25 of {len(d)}; shift ghost->real in mm (+dx right in image, +dy down = ghost sits too HIGH); straight pitch {p0:.1f}')
    def line(name, s):
        if len(s) < 3: print(f'  {name:22s} n {len(s):3d}'); return None
        print(f'  {name:22s} n {len(s):3d}  dx {np.median(s[:,3]):+5.1f} ({np.percentile(s[:,3],25):+.1f}..{np.percentile(s[:,3],75):+.1f})   dy {np.median(s[:,4]):+5.1f} ({np.percentile(s[:,4],25):+.1f}..{np.percentile(s[:,4],75):+.1f})  clip {int(s[:,6].sum())}')
        return np.median(s[:, 3]), np.median(s[:, 4])
    print(' by clip segment'); 
    for n, a, b in BINS: line(n, rows[(rows[:, 0] >= a) & (rows[:, 0] <= b)])
    print(' by yaw (|pitch-p0|<8)'); meds = []
    for lo, hi in [(-60, -35), (-35, -22), (-22, -10), (-10, 10), (10, 22), (22, 35), (35, 60)]:
        m = line(f'yaw {lo:+3d}..{hi:+3d}', rows[(rows[:, 1] >= lo) & (rows[:, 1] < hi) & (abs(rows[:, 2] - p0) < 8)]); 
        if m: meds.append(m)
    print(' by pitch rel. straight (|yaw|<10), + = up'); 
    for lo, hi in [(-40, -18), (-18, -8), (-8, 8), (8, 18), (18, 40)]:
        m = line(f'pitch {lo:+3d}..{hi:+3d}', rows[(rows[:, 2] - p0 >= lo) & (rows[:, 2] - p0 < hi) & (abs(rows[:, 1]) < 10)])
        if m and not (lo == -8): meds.append(m)
    meds = np.array(meds); print(f'  SWIM: range of bin medians dx {np.ptp(meds[:,0]):.1f} mm, dy {np.ptp(meds[:,1]):.1f} mm;  rms about straight: dx {np.sqrt(np.mean((rows[:,3]-np.median(rows[:,3]))**2)):.2f} dy {np.sqrt(np.mean((rows[:,4]-np.median(rows[:,4]))**2)):.2f}')
