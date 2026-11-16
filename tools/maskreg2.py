import numpy as np, cv2, json
from PIL import Image
from maskreg import hmask, cmask
A=hmask('h12').astype(np.float32); B=cmask().astype(np.float32)
D=8
a=cv2.resize(A,(A.shape[1]//D,A.shape[0]//D),interpolation=cv2.INTER_AREA); b=cv2.resize(B,(B.shape[1]//D,B.shape[0]//D),interpolation=cv2.INTER_AREA)
best=None
for s in np.linspace(1.0,1.6,61):   # hinan px per H px
    t=cv2.resize(a,(int(a.shape[1]*s),int(a.shape[0]*s)))
    ys,xs=np.where(t>0.5); t=t[ys.min():ys.max()+1,xs.min():xs.max()+1]; oy,ox=ys.min(),xs.min()
    if t.shape[0]>=b.shape[0] or t.shape[1]>=b.shape[1]: continue
    pb=np.pad(b,((t.shape[0],t.shape[0]),(t.shape[1],t.shape[1])))
    r=cv2.matchTemplate(pb,t,cv2.TM_CCORR)
    _,mv,_,ml=cv2.minMaxLoc(r)
    inter=mv; union=t.sum()+b.sum()-inter; iou=inter/union
    if best is None or iou>best[0]: best=(iou,s,(ml[0]-t.shape[1]-ox,ml[1]-t.shape[0]-oy))
iou,s,(tx,ty)=best; print('iou',round(iou,3),'s',round(s,3),tx*D,ty*D)
# H px -> hinan px : u = s*x + tx*D
json.dump({'s':float(s),'tx':float(tx*D),'ty':float(ty*D)},open('h2hinan.json','w'))
