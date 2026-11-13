"""区の全地図枠を位置合わせする（georef → refine2、失敗した枠は位置合わせ済みの枠と照合して再挑戦）。
使い方: 作業フォルダで  CFG=frames.json LAT=35.18 python3 align_ward.py"""
import json, os, subprocess, sys, re
cfg = json.load(open(os.environ.get('CFG', 'frames.json')))
here = os.path.dirname(os.path.abspath(__file__))
def run(*a):
    r = subprocess.run([sys.executable, os.path.join(here, a[0]), *a[1:]], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip().splitlines()
def ok(lines):
    m = [l for l in lines if ' it 2 ' in l]
    if not m: return None
    mm = re.search(r'inliers (\d+) \((\d+)%\).*resid m ([\d.]+)', m[-1])
    n, pct, res = int(mm.group(1)), int(mm.group(2)), float(mm.group(3))
    return (n, pct, res) if n >= 10 and pct >= 80 and res <= 4 else None
if not os.path.exists('georef_out.json') or '--fresh' in sys.argv:
    if os.path.exists('georef_out.json'): os.remove('georef_out.json')
    run('georef.py', os.environ.get('CFG', 'frames.json'))
frames = cfg['frames']; scale = {f['id']: f['scale'] for f in frames}; page = {f['id']: f['page'] for f in frames}
done = {}
for f in frames:
    r = ok(run('refine2.py', f['id']))
    if r: done[f['id']] = r
for rnd in range(2):
    for f in frames:
        fid = f['id']
        if fid in done: continue
        # 同じ縮尺の枠 → 避難所マップ → その他、の順に照合
        cands = sorted(done, key=lambda d: (scale[d] != scale[fid], 'hinanjyo' not in d, page[d] == page[fid]))
        for ref in cands:
            run('chain.py', fid, ref)
            r = ok(run('refine2.py', fid))
            if r: done[fid] = r; print(f'{fid}: via {ref}'); break
for f in frames:
    print(f"{f['id']:20s}", 'OK inliers=%d (%d%%) resid=%.1fm' % done[f['id']] if f['id'] in done else 'FAILED')
