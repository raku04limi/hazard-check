import numpy as np, cv2, json, math, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
fid=sys.argv[1]; scale=float(sys.argv[2])
c=json.load(open('frames.json')); fr={f['id']:f for f in c['frames']}[fid]
P=np.asarray(Image.open(f"pages/{fr['page']}.png").convert('RGB')).astype(np.int16); H,W,_=P.shape
mx=P.max(2); mn=P.min(2)
road=((mn>225)&(mx-mn<25)).astype(np.float32)
pm=np.zeros((H,W),np.uint8); cv2.fillPoly(pm,[np.array([[x/100*W,y/100*H] for x,y in fr['poly']],np.int32)],1); road*=pm
G=np.asarray(Image.open('gsi16.png').convert('RGB')).astype(np.int16)
gmn=G.min(2); gmx=G.max(2); groad=((gmn>248)).astype(np.float32)
ox,oy=map(int,open('gsi16.origin').read().split())
lat=35.25; M16=156543.03*math.cos(math.radians(lat))/2**16
best=None
for sc in np.linspace(0.94,1.06,13):
    f=scale*0.0254/160.6/M16*sc   # gsi px per page px
    D=2
    ys,xs=np.where(pm); y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
    T=cv2.resize(road[y0:y1,x0:x1],(int((x1-x0)*f/D),int((y1-y0)*f/D)),interpolation=cv2.INTER_AREA)
    Gs=cv2.resize(groad,(groad.shape[1]//D,groad.shape[0]//D),interpolation=cv2.INTER_AREA)
    T=cv2.GaussianBlur(T,(0,0),1); Gs=cv2.GaussianBlur(Gs,(0,0),1)
    r=cv2.matchTemplate(Gs,T,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(r)
    r2=r.copy(); r2[max(0,ml[1]-10):ml[1]+11,max(0,ml[0]-10):ml[0]+11]=-1
    if best is None or mv>best[0]: best=(mv,sc,ml,f,(x0,y0),mv-r2.max())
mv,sc,ml,f,(x0,y0),mg=best; print(fid,'ncc',round(mv,3),'margin',round(mg,3),'sc',sc)
gx0=ml[0]*2; gy0=ml[1]*2; k=f
A=np.array([[1/(4*k),0],[0,1/(4*k)],[-(ox+gx0)/k+x0,-(oy+gy0)/k+y0]])
go=json.load(open('georef_out.json'))
go[fid]={'A0':A.tolist(),'coarse':[float(mv),float(mg)],'rect':[int(x0),int(y0),W,H],'scale':scale,'poly':[[x/100*W,y/100*H] for x,y in fr['poly']],'W':W,'H':H}
json.dump(go,open('georef_out.json','w'))
