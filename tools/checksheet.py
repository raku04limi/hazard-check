"""位置合わせの目視確認用：指定地点の周辺を、地理院地図と各地図枠から切り抜いて並べる。
使い方: python3 checksheet.py <作業フォルダ> <設定JSON> <経度> <緯度> <出力PNG>"""
import json, math, sys, os, numpy as np
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = None
work, cfgp, lon, lat, outp = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
cfg = json.load(open(cfgp)); go = json.load(open(os.path.join(work, 'georef_out.json')))
page_of = {f['id']: f['page'] for f in cfg['frames']}
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
def merc(lon, lat, z):
    n = 256 * 2 ** z; x = (lon + 180) / 360 * n; r = math.radians(lat)
    return x, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
X, Y = merc(lon, lat, 18); half = 250
mpp18 = 156543.03 * math.cos(math.radians(lat)) / 2 ** 18
cells = []
z = 16; cx, cy = merc(lon, lat, z); R = int(half / (mpp18 * 4))
g = Image.new('RGB', (2 * R, 2 * R), 'white')
for tx in range(int((cx - R) // 256), int((cx + R) // 256) + 1):
    for ty in range(int((cy - R) // 256), int((cy + R) // 256) + 1):
        p = os.path.join(work, f'tiles/std_{z}_{tx}_{ty}.png')
        if os.path.exists(p): g.paste(Image.open(p).convert('RGB'), (int(tx * 256 - (cx - R)), int(ty * 256 - (cy - R))))
cells.append(('GSI', g.resize((240, 240))))
pages = {}
for fid, gd in go.items():
    if fid not in page_of or 'A' not in gd: continue
    A = np.array(gd['A']); u, v = np.array([X, Y, 1]) @ A
    k = math.sqrt(abs(np.linalg.det(A[:2, :2]))); r = half / mpp18 * k
    pg = page_of[fid]
    if pg not in pages: pages[pg] = Image.open(os.path.join(work, 'pages', pg + '.png')).convert('RGB')
    inside = 0 <= u < gd['W'] and 0 <= v < gd['H']
    c = pages[pg].crop((u - r, v - r, u + r, v + r)).resize((240, 240)) if inside else Image.new('RGB', (240, 240), '#ddd')
    cells.append((fid, c))
cols = 6; sheet = Image.new('RGB', (cols * 250, ((len(cells) + cols - 1) // cols) * 262), 'white'); d = ImageDraw.Draw(sheet)
for i, (n, c) in enumerate(cells):
    x, y = (i % cols) * 250, (i // cols) * 262
    dc = ImageDraw.Draw(c); dc.line((110, 120, 130, 120), fill='red', width=2); dc.line((120, 110, 120, 130), fill='red', width=2)
    sheet.paste(c, (x, y + 16)); d.text((x + 2, y), n, fill='black', font=f)
sheet.save(outp)
