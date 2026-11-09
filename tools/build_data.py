"""解析済みのハザードマップ（位置合わせ・範囲・凡例）を、アプリが読む data/ に書き出す。

使い方: python3 tools/build_data.py <作業フォルダ> <区の設定JSON> <出力先 data フォルダ>
作業フォルダには pages/<page>.png（160.6dpiで画像化したページ）、georef_out.json、legends.json がある前提。
"""
import json, math, os, sys
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

work, cfg_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(cfg_path))
go = json.load(open(os.path.join(work, 'georef_out.json')))
legends = json.load(open(os.path.join(work, 'legends.json')))
TILE = 512

def merc_inv(X, Y, z=18):
    n = 256 * 2 ** z
    lon = X / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / n))))
    return lon, lat

index_path = os.path.join(out, 'index.json')
index = json.load(open(index_path)) if os.path.exists(index_path) else {'version': 1, 'pages': {}, 'frames': []}
ward_key = cfg['key']
index['frames'] = [f for f in index['frames'] if f.get('ward') != ward_key]

for pid, p in cfg['pages'].items():
    page_id = f'{ward_key}-{pid}'
    im = Image.open(os.path.join(work, 'pages', f'{pid}.png')).convert('RGB')
    W, H = im.size
    d = os.path.join(out, 'tiles', page_id)
    os.makedirs(d, exist_ok=True)
    for ty in range(0, (H + TILE - 1) // TILE):
        for tx in range(0, (W + TILE - 1) // TILE):
            t = im.crop((tx * TILE, ty * TILE, min(W, (tx + 1) * TILE), min(H, (ty + 1) * TILE)))
            t.save(os.path.join(d, f'{tx}_{ty}.jpg'), quality=85, optimize=True)
    index['pages'][page_id] = {'title': p['title'], 'ward': cfg['ward'], 'source': p['source'], 'width': W, 'height': H, 'tile': TILE}
    print('tiles', page_id, W, H)

for fr in cfg['frames']:
    g = go[fr['id']]
    A = np.array(g['A'])  # [X18, Y18, 1] -> page px
    poly = g['poly']
    xs = [q[0] for q in poly]; ys = [q[1] for q in poly]
    # 範囲の四隅＋中央を、ページpx→緯度経度に戻して制御点にする
    M = np.array([[A[0, 0], A[1, 0]], [A[0, 1], A[1, 1]]]); Minv = np.linalg.inv(M)
    pts = []
    for (x, y) in [(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys)), ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)]:
        X, Y = Minv @ (np.array([x, y]) - A[2])
        lon, lat = merc_inv(X, Y)
        pts.append({'px': round(x, 2), 'py': round(y, 2), 'lat': round(lat, 7), 'lon': round(lon, 7)})
    lons = [q['lon'] for q in pts]; lats = [q['lat'] for q in pts]
    pg = cfg['pages'][fr['page']]
    index['frames'].append({
        'id': f"{ward_key}-{fr['id']}", 'ward': ward_key, 'page': f"{ward_key}-{fr['page']}",
        'name': pg['title'], 'label': fr.get('label', ''), 'category': fr.get('category', pg['category']),
        'legend': legends.get(fr.get('legend', ''), []), 'tolerance': fr.get('tolerance', 24),
        'points': pts, 'area': [[round(x, 1), round(y, 1)] for x, y in poly],
        'bbox': [min(lons), min(lats), max(lons), max(lats)],
        'accuracy_m': round(g.get('stats', {}).get('resid_m', 0), 1),
    })
index['wards'] = {**index.get('wards', {}), ward_key: {'name': cfg['ward'], 'source': cfg['source']}}
json.dump(index, open(index_path, 'w'), ensure_ascii=False, separators=(',', ':'))
print('frames', len(index['frames']))
