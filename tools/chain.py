import json, sys, numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
import os
cfg=json.load(open(os.environ.get('CFG','frames.json'))); go=json.load(open('georef_out.json'))
PAGE={f['id']:f['page'] for f in cfg['frames']}
scales={f['id']:f['scale'] for f in cfg['frames']}
def page_of(fid): return PAGE[fid]
def feat(a,s=1.0):
    gx=cv2.Sobel(a,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(a,cv2.CV_32F,0,1,ksize=3)
    return cv2.GaussianBlur(np.minimum(np.hypot(gx,gy),200)/200,(0,0),s)
tgt,ref=sys.argv[1],sys.argv[2]
T=np.asarray(Image.open(f'pages/{page_of(tgt)}.png').convert('L')).astype(np.float32)
R=np.asarray(Image.open(f'pages/{page_of(ref)}.png').convert('L')).astype(np.float32)
rx0,ry0,rx1,ry1=go[tgt]['rect']
if page_of(tgt)==page_of(ref): R=R.copy(); R[ry0:ry1,rx0:rx1]=255
D=4
tmpl=T[ry0:ry1,rx0:rx1]
L=lambda v: v if isinstance(v,list) else [v]
rs=[go[ref]['scale']] if 'scale' in go[ref] else L(scales[ref])
bases=sorted({t/r for t in L(scales[tgt]) for r in rs})
Rs=feat(cv2.resize(R,(R.shape[1]//D,R.shape[0]//D),interpolation=cv2.INTER_AREA))
best=None
for base,sc in [(b,x) for b in bases for x in np.linspace(0.96,1.04,9)]:
    s=base*sc
    t=cv2.resize(tmpl,(int(tmpl.shape[1]*s/D),int(tmpl.shape[0]*s/D)),interpolation=cv2.INTER_AREA)
    if t.shape[0]>=Rs.shape[0] or t.shape[1]>=Rs.shape[1]: 
        # crop center
        h=min(t.shape[0],Rs.shape[0]-4); w=min(t.shape[1],Rs.shape[1]-4); cy=(t.shape[0]-h)//2; cx=(t.shape[1]-w)//2
        t=t[cy:cy+h,cx:cx+w]; off=(cx,cy)
    else: off=(0,0)
    r=cv2.matchTemplate(Rs,feat(t),cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(r)
    if best is None or mv>best[0]: best=(mv,s,ml,off)
mv,s,ml,off=best
# ref px = s*(tgt px - (rx0,ry0)) + (ml-off)*D
t=np.array([(ml[0]-off[0])*D - s*rx0, (ml[1]-off[1])*D - s*ry0])
Aref=np.array(go[ref]['A'])
# tgt px = (ref px - t)/s ; ref px = [X,Y,1]@Aref
A=Aref.copy()/s; A[2]=(Aref[2]-t)/s
go[tgt]['A0']=A.tolist(); go[tgt].pop('A',None)
print(tgt,'via',ref,'ncc',round(float(mv),3),'s',round(s,4))
json.dump(go,open('georef_out.json','w'))
