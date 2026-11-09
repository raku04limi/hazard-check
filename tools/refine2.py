import json, math, sys, numpy as np, cv2
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
ids=sys.argv[1:]
go=json.load(open('georef_out.json'))
ox,oy=map(int,open('gsi16.origin').read().split())
G=np.asarray(Image.open('gsi16.png').convert('L')).astype(np.float32)
gh,gw=G.shape
M16=156543.03*math.cos(math.radians(35.08))/2**16
def feat(a):
    gx=cv2.Sobel(a,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(a,cv2.CV_32F,0,1,ksize=3)
    return cv2.GaussianBlur(np.minimum(np.hypot(gx,gy),200)/200,(0,0),1.2)
FG=feat(G)
gx,gy=np.meshgrid(np.arange(gw,dtype=np.float32),np.arange(gh,dtype=np.float32))
X18=(gx+ox)*4; Y18=(gy+oy)*4
for fid in (ids or go.keys()):
    g=go[fid]; page=fid if fid in ('tameike-1','tameike-2') else fid.split('-')[0]
    P=np.asarray(Image.open(f'pages/{page}.png').convert('L')).astype(np.float32); H,W=P.shape
    pm=np.zeros((H,W),np.uint8); cv2.fillPoly(pm,[np.array(g['poly'],np.int32)],1)
    A=np.array(g.get('A',g['A0']))
    for it in range(3):
        mapx=(X18*A[0,0]+Y18*A[1,0]+A[2,0]).astype(np.float32); mapy=(X18*A[0,1]+Y18*A[1,1]+A[2,1]).astype(np.float32)
        Wp=cv2.remap(P,mapx,mapy,cv2.INTER_AREA,borderValue=255)
        V=cv2.remap(pm,mapx,mapy,cv2.INTER_NEAREST,borderValue=0).astype(bool)
        FW=feat(Wp)
        k=math.sqrt(abs(np.linalg.det(A[:2,:2])))*4  # page px per gsi16 px
        Pz=max(96,int(192/max(k,0.5)*0.6)) if k<1 else 192
        Rr=40 if it==0 else 12; res=[]
        for y in range(Rr, gh-Pz-Rr, Pz//2):
            for x in range(Rr, gw-Pz-Rr, Pz//2):
                if V[y:y+Pz,x:x+Pz].mean()<0.98: continue
                t=FW[y:y+Pz,x:x+Pz]
                if t.std()<0.05: continue
                s=FG[y-Rr:y+Pz+Rr,x-Rr:x+Pz+Rr]
                r=cv2.matchTemplate(s,t,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(r)
                r2=r.copy(); r2[max(0,ml[1]-5):ml[1]+6,max(0,ml[0]-5):ml[0]+6]=-1
                res.append((x+Pz/2,y+Pz/2,ml[0]-Rr,ml[1]-Rr,mv,mv-r2.max()))
        res=np.array(res)
        if len(res)==0: print(fid,'no patches'); break
        good=res[(res[:,4]>0.25)&(res[:,5]>0.03)]
        if len(good)<6: print(fid,'it',it,'too few good',len(good),'of',len(res)); break
        pts=good[:,:2]; d=good[:,2:4]; keep=np.ones(len(good),bool)
        for _ in range(10):
            C,*_=np.linalg.lstsq(np.c_[pts[keep],np.ones(keep.sum())],d[keep],rcond=None)
            e=np.linalg.norm(np.c_[pts,np.ones(len(pts))]@C-d,axis=1)
            nk=e<max(3*np.median(e[keep]),2.0)
            if (nk==keep).all(): break
            keep=nk
        frac=keep.sum()/len(good)
        print(fid,'it',it,'patches',len(res),'good',len(good),'inliers',keep.sum(),f'({frac:.0%})','median shift m',round(float(np.median(np.linalg.norm(d[keep],axis=1))*M16),1),'resid m',round(float(np.sqrt((e[keep]**2).mean())*M16),1))
        samp=[]
        for yy in np.linspace(0,gh,15):
            for xx in np.linspace(0,gw,15):
                dq=np.array([xx,yy,1])@C; q=np.array([xx,yy])-dq
                sx,sy=np.array([(q[0]+ox)*4,(q[1]+oy)*4,1])@A
                samp.append([(xx+ox)*4,(yy+oy)*4,1,sx,sy])
        samp=np.array(samp); A,*_=np.linalg.lstsq(samp[:,:3],samp[:,3:],rcond=None)
        g['A']=A.tolist(); g['stats']={'inliers':int(keep.sum()),'good':int(len(good)),'patches':int(len(res)),'resid_m':float(np.sqrt((e[keep]**2).mean())*M16)}
    json.dump(go,open('georef_out.json','w'))
