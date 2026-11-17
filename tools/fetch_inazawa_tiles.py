import math, os, io, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
B='https://www2.city.inazawa.aichi.jp/hazardmap/Tile/'
OUT='/home/user/hazard-check/data/raster/'
def t(lon,lat,z=16):
    n=2**z; return int((lon+180)/360*n), int((1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n)
x0,y0=t(136.69,35.32); x1,y1=t(136.89,35.17)
jobs=[(l,x,y) for l in ['L2_kiso_4','L2_kisoigai_4'] for x in range(x0,x1+1) for y in range(y0,y1+1)]
print(len(jobs))
def get(j):
    l,x,y=j
    try:
        d=urllib.request.urlopen(f'{B}{l}/16/{x}/{y}.png',timeout=30).read()
        if d[:4]!=b'\x89PNG': return 'skip'
        im=Image.open(io.BytesIO(d)).convert('RGBA')
        if im.getextrema()[3][1]==0: return 'empty'
        name={'L2_kiso_4':'inazawa_kiso','L2_kisoigai_4':'inazawa_kisoigai'}[l]
        p=f'{OUT}{name}/16/{x}'; os.makedirs(p,exist_ok=True)
        q=im.quantize(colors=16,method=Image.Quantize.FASTOCTREE)
        q.save(f'{p}/{y}.png',optimize=True,transparency=None) if False else None
        # keep transparency: map alpha<128 to a dedicated palette index
        a=im.getchannel('A').point(lambda v:255 if v>=128 else 0)
        rgb=Image.new('RGB',im.size,(0,0,0)); rgb.paste(im.convert('RGB'),mask=a)
        pal=rgb.quantize(colors=15,method=Image.Quantize.MEDIANCUT)
        px=pal.load(); am=a.load(); w,h=im.size
        P=pal.getpalette()[:45]+[0,0,0]; 
        out=Image.new('P',im.size); out.putpalette(P+[0]*(768-len(P)))
        o=out.load()
        for yy in range(h):
            for xx in range(w): o[xx,yy]=px[xx,yy] if am[xx,yy] else 15
        out.save(f'{p}/{y}.png',optimize=True,transparency=15)
        return 'ok'
    except Exception as e: return 'err '+str(e)[:60]
from collections import Counter
jobs=[j for j in jobs if not os.path.exists(f"{OUT}{ {"L2_kiso_4":"inazawa_kiso","L2_kisoigai_4":"inazawa_kisoigai"}[j[0]]}/16/{j[1]}/{j[2]}.png")]
print("retry",len(jobs))
with ThreadPoolExecutor(3) as ex: R=list(ex.map(get,jobs)); print(Counter(r.split()[0] for r in R)); print([r for r in R if r.startswith("err")][:3])
