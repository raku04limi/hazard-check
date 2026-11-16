# 背景色が違う地図どうしを、文字・道路の黒線（暗い画素）で照合する
import numpy as np, cv2, json, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
tgt, ref = sys.argv[1], sys.argv[2]
PAGE={f['id']:f['page'] for f in json.load(open('frames.json'))['frames']}
def dark(n):
    g=np.asarray(Image.open(f'pages/{PAGE.get(n,n)}.png').convert('RGB')).astype(np.float32)
    v=g.min(2); m=(v<90).astype(np.float32)
    return cv2.GaussianBlur(m,(0,0),1.5)
A=dark(tgt); B=dark(ref)
c=json.load(open('frames.json')); fr={f['id']:f for f in c['frames']}
H,W=A.shape; p=fr[tgt]['poly']
xs=[x/100*W for x,y in p]; ys=[y/100*H for x,y in p]
# center crop of target map area
cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2; w=(max(xs)-min(xs))*.45; h=(max(ys)-min(ys))*.45
T=A[int(cy-h/2):int(cy+h/2),int(cx-w/2):int(cx+w/2)]
best=None
for s in np.linspace(float(sys.argv[3]),float(sys.argv[4]),int(sys.argv[5])):
    t=cv2.resize(T,(int(T.shape[1]*s/2),int(T.shape[0]*s/2)),interpolation=cv2.INTER_AREA)
    b=cv2.resize(B,(B.shape[1]//2,B.shape[0]//2),interpolation=cv2.INTER_AREA)
    if t.shape[0]>=b.shape[0] or t.shape[1]>=b.shape[1]: continue
    r=cv2.matchTemplate(b,t,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(r)
    if best is None or mv>best[0]: best=(mv,s,ml)
mv,s,ml=best; print('ncc',round(mv,3),'s',round(s,4))
# ref px = s*(tgt px - (x0,y0)) + ml*2
x0,y0=int(cx-w/2),int(cy-h/2)
M=np.array([[s,0,ml[0]*2-s*x0],[0,s,ml[1]*2-s*y0]])
json.dump({'M':M.tolist(),'ncc':mv},open(f'{tgt}_to_{ref}.json','w'))
