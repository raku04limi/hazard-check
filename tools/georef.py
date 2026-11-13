import json, math, sys, numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
cfg=json.load(open(sys.argv[1])); only=sys.argv[2:] 
ox,oy=map(int,open('gsi16.origin').read().split())
G=np.asarray(Image.open('gsi16.png').convert('L')).astype(np.float32)
import os
LAT=float(os.environ.get('LAT','35.08'))
M16=156543.03*math.cos(math.radians(LAT))/2**16
def feat(a,s=1.2):
    gx=cv2.Sobel(a,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(a,cv2.CV_32F,0,1,ksize=3)
    return cv2.GaussianBlur(np.minimum(np.hypot(gx,gy),200)/200,(0,0),s)
FG=feat(G)
def pip(x,y,poly):
    m=np.zeros(x.shape,np.uint8)
    x0,y0=x[0,0],y[0,0]; st=(x[0,1]-x[0,0]) if x.shape[1]>1 else 1
    pts=np.array([[(px-x0)/st,(py-y0)/st] for px,py in poly],np.int32)
    cv2.fillPoly(m,[pts],1); return m.astype(bool)
def inscribed(mask):
    # largest rectangle of True in a coarse grid
    N=60; h,w=mask.shape; gh,gw=N,N
    small=cv2.resize(mask.astype(np.uint8),(gw,gh),interpolation=cv2.INTER_AREA)>=1
    best=(0,0,0,0,0); hist=np.zeros(gw,int)
    for j in range(gh):
        hist=np.where(small[j],hist+1,0); st=[]
        for i in range(gw+1):
            cur=hist[i] if i<gw else 0; start=i
            while st and st[-1][1]>=cur:
                si,sh=st.pop(); a=sh*(i-si)
                if a>best[0]: best=(a,si,j-sh+1,i,j+1)
                start=si
            st.append((start,cur))
    _,i0,j0,i1,j1=best
    return int(i0*w/gw),int(j0*h/gh),int(i1*w/gw),int(j1*h/gh)
pages={}
out={}
try: out=json.load(open('georef_out.json'))
except: pass
for fr in cfg['frames']:
    if only and fr['id'] not in only: continue
    pg=fr['page']
    if pg not in pages: pages[pg]=np.asarray(Image.open(f'pages/{pg}.png').convert('L')).astype(np.float32)
    P=pages[pg]; H,W=P.shape
    poly=cfg['layouts'][fr['poly']] if isinstance(fr['poly'],str) else fr['poly']
    polypx=[[x/100*W,y/100*H] for x,y in poly]
    xs=[p[0] for p in polypx]; ys=[p[1] for p in polypx]
    bx0,by0,bx1,by1=int(max(0,min(xs))),int(max(0,min(ys))),int(min(W,max(xs))),int(min(H,max(ys)))
    yy,xx=np.mgrid[by0:by1:4,bx0:bx1:4]
    m=pip(xx+0.5,yy+0.5,polypx)
    ix0,iy0,ix1,iy1=inscribed(m)
    rx0,ry0,rx1,ry1=bx0+ix0*4,by0+iy0*4,bx0+ix1*4,by0+iy1*4
    cands=fr['scale'] if isinstance(fr['scale'],list) else [fr['scale']]
    BEST=None
    for SCALE in cands:
        mpp=SCALE*0.0254/cfg['dpi']
        f=mpp/M16
        # coarse search: downscale everything by D
        D=4
        T=P[ry0:ry1,rx0:rx1]
        Ts=cv2.resize(T,(max(8,int(T.shape[1]*f/D)),max(8,int(T.shape[0]*f/D))),interpolation=cv2.INTER_AREA)
        Gs=cv2.resize(G,(G.shape[1]//D,G.shape[0]//D),interpolation=cv2.INTER_AREA)
        best=None
        for sc in [0.97,0.985,1.0,1.015,1.03]:
            Tsc=cv2.resize(Ts,(int(Ts.shape[1]*sc),int(Ts.shape[0]*sc)),interpolation=cv2.INTER_AREA)
            if Tsc.shape[0]>=Gs.shape[0] or Tsc.shape[1]>=Gs.shape[1]:
                # template bigger than mosaic: crop the template center
                cy,cx=Tsc.shape[0]//2,Tsc.shape[1]//2; hh=min(Tsc.shape[0],Gs.shape[0]-10)//2; hw=min(Tsc.shape[1],Gs.shape[1]-10)//2
                Tsc=Tsc[cy-hh:cy+hh,cx-hw:cx+hw]; off=((Ts.shape[1]*sc)/2-hw,(Ts.shape[0]*sc)/2-hh)
            else: off=(0,0)
            r=cv2.matchTemplate(feat(Gs,1.0),feat(Tsc,1.0),cv2.TM_CCOEFF_NORMED)
            _,mv,_,ml=cv2.minMaxLoc(r)
            r2=r.copy(); r2[max(0,ml[1]-8):ml[1]+9,max(0,ml[0]-8):ml[0]+9]=-1
            if best is None or mv>best[0]: best=(mv,sc,ml,off,mv-r2.max())

        if BEST is None or best[0]>BEST[0][0]: BEST=(best,f,SCALE)
    best,f,SCALE=BEST
    print(fr['id'],'scale',SCALE)
    mv,sc,ml,off,margin=best
    # page px (rx0,ry0) -> gsi16 px
    k=f*sc
    gx0=(ml[0]-off[0])*D; gy0=(ml[1]-off[1])*D
    # A: [X18,Y18,1] -> page px ; X16 = gx+ox ; page = (gx - gx0)/k + rx0
    A=np.array([[1/(4*k),0],[0,1/(4*k)],[-(ox+gx0)/k+rx0,-(oy+gy0)/k+ry0]])
    print(fr['id'],'coarse ncc',round(mv,3),'margin',round(margin,3),'scale adj',sc)
    out[fr['id']]={'A0':A.tolist(),'coarse':[float(mv),float(margin)],'rect':[rx0,ry0,rx1,ry1],'scale':SCALE,'poly':polypx,'W':W,'H':H}
    json.dump(out,open('georef_out.json','w'))
