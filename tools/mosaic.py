import math, urllib.request, io, os, sys, numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
def tile(lon,lat,z):
    n=2**z; x=(lon+180)/360*n; r=math.radians(lat); y=(1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n; return x,y
def build(lon0,lat0,lon1,lat1,z,out,layer='std'):
    x0,y0=tile(lon0,lat1,z); x1,y1=tile(lon1,lat0,z)
    X0,Y0,X1,Y1=int(x0),int(y0),int(x1),int(y1)
    img=Image.new('RGB',((X1-X0+1)*256,(Y1-Y0+1)*256),'white')
    os.makedirs('tiles',exist_ok=True)
    def get(t):
        tx,ty=t; fn=f'tiles/{layer}_{z}_{tx}_{ty}.png'
        if not os.path.exists(fn):
            try: open(fn,'wb').write(urllib.request.urlopen(f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{tx}/{ty}.png',timeout=30).read())
            except Exception as e: return t,None
        return t,fn
    with ThreadPoolExecutor(8) as ex:
        for (tx,ty),fn in ex.map(get,[(tx,ty) for tx in range(X0,X1+1) for ty in range(Y0,Y1+1)]):
            if fn: img.paste(Image.open(fn).convert('RGB'),((tx-X0)*256,(ty-Y0)*256))
    img.save(out); return X0*256,Y0*256
if __name__=='__main__':
    ox,oy=build(136.90,35.02,137.06,35.14,16,'gsi16.png')
    open('gsi16.origin','w').write(f'{ox} {oy}')
    print(ox,oy,Image.open('gsi16.png').size)
