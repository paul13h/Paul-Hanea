# Shared helper: find frames that cannot be read (iCloud-evicted / truncated files) so the tools can skip them.
import os, threading
def readable(p, timeout=10):
    ok = []
    if getattr(os.stat(p), 'st_flags', 0) & 0x40000000: return False   # evicted: do not trigger a slow download
    def go():
        try:
            with open(p, 'rb') as f: d = f.read()
            ok.append(len(d) > 1000 and d[:2] == b'\xff\xd8' and d[-2:] == b'\xff\xd9')
        except OSError: ok.append(False)
    t = threading.Thread(target=go, daemon=True); t.start(); t.join(timeout)
    return bool(ok and ok[0])
def scan(dirpath, frames):
    """-> (bad index list, substitute list: for each index the nearest readable index or None)"""
    bad = [i for i, f in enumerate(frames) if not readable(f'{dirpath}/{f}')]
    good = [i for i in range(len(frames)) if i not in set(bad)]
    sub = [min(good, key=lambda g: abs(g - i)) if good else None for i in range(len(frames))]
    if bad: print('UNREADABLE frames in', dirpath, ':', bad, flush=True)
    return bad, sub

def dataless(dirpath):
    """frames that iCloud evicted (stat flag SF_DATALESS); reading them blocks while macOS downloads them"""
    return [n for n in sorted(os.listdir(dirpath)) if n.endswith('.jpg') and os.stat(f'{dirpath}/{n}').st_flags & 0x40000000]
if __name__ == '__main__':   # python3 frames.py DIR -> number of evicted frames
    import sys; print(len(dataless(sys.argv[1])) if os.path.isdir(sys.argv[1]) else 0)
