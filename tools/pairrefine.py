import numpy as np, cv2, json, sys, math
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
tgt, ref, mode = sys.argv[1], sys.argv[2], sys.argv[3]
M=np.array(json.load(open(f'{tgt}_to_{ref}.json'))['M'],np.float32)
PAGE={f['id']:f['page'] for f in json.load(open('frames.json'))['frames']}
def load(n):
    g=np.asarray(Image.open(f'pages/{PAGE.get(n,n)}.png').convert('RGB')).astype(np.float32)
    if mode=='dark': v=(g.min(2)<90).astype(np.float32); return cv2.GaussianBlur(v,(0,0),1.5)
    L=g.mean(2); gx=cv2.Sobel(L,cv2.CV_32F,1,0); gy=cv2.Sobel(L,cv2.CV_32F,0,1); return cv2.GaussianBlur(np.minimum(np.hypot(gx,gy),150)/150,(0,0),2)
A=load(tgt); B=load(ref); hh,hw=B.shape
c=json.load(open('frames.json')); fr={f['id']:f for f in c['frames']}
pt=fr[tgt]['poly']; H,W=A.shape
tm=np.zeros((H,W),np.uint8); cv2.fillPoly(tm,[np.array([[x/100*W,y/100*H] for x,y in pt],np.int32)],1)
pr=fr[ref]['poly']; rm=np.zeros((hh,hw),np.uint8); cv2.fillPoly(rm,[np.array([[x/100*hw,y/100*hh] for x,y in pr],np.int32)],1)
for it in range(5):
    Wp=cv2.warpAffine(A,M,(hw,hh),flags=cv2.INTER_AREA); V=cv2.warpAffine(tm,M,(hw,hh),flags=cv2.INTER_NEAREST)&rm
    P=150; R=40 if it<2 else 12; res=[]
    for y in range(R,hh-P-R,P//2):
        for x in range(R,hw-P-R,P//2):
            if V[y:y+P,x:x+P].mean()<.97: continue
            t=Wp[y:y+P,x:x+P]
            if t.std()<0.04: continue
            r=cv2.matchTemplate(B[y-R:y+P+R,x-R:x+P+R],t,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(r)
            r2=r.copy(); r2[max(0,ml[1]-4):ml[1]+5,max(0,ml[0]-4):ml[0]+5]=-1
            res.append((x+P/2,y+P/2,ml[0]-R,ml[1]-R,mv,mv-r2.max()))
    res=np.array(res); g=res[(res[:,4]>0.15)&(res[:,5]>0.02)]
    if len(g)<8: print('too few',len(g),len(res)); sys.exit(1)
    pts=g[:,:2]; d=g[:,2:4]; keep=np.ones(len(g),bool)
    for _ in range(10):
        C,*_=np.linalg.lstsq(np.c_[pts[keep],np.ones(keep.sum())],d[keep],rcond=None)
        e=np.linalg.norm(np.c_[pts,np.ones(len(pts))]@C-d,axis=1); nk=e<max(3*np.median(e[keep]),2.5)
        if (nk==keep).all(): break
        keep=nk
    print(tgt,'it',it,'patches',len(res),'good',len(g),'inl',keep.sum(),'shift',round(float(np.median(np.linalg.norm(d[keep],axis=1))),1),'resid px',round(float(np.sqrt((e[keep]**2).mean())),2))
    src=[];dst=[]; Mi=cv2.invertAffineTransform(M)
    for (x,y) in pts[keep]:
        q=np.array([x,y]); dq=np.array([x,y,1])@C; src.append(Mi@np.array([x,y,1])); dst.append(q+dq)
    M=cv2.estimateAffine2D(np.array(src,np.float32),np.array(dst,np.float32))[0].astype(np.float32)
go=json.load(open('georef_out.json')); Ah=np.array(go[ref]['A'])
M3=np.vstack([M,[0,0,1]]); A3=np.c_[Ah,[0,0,1]]; At=(A3@np.linalg.inv(M3).T)[:,:2]
poly=[[x/100*W,y/100*H] for x,y in pt]
go[tgt]={'A':At.tolist(),'A0':At.tolist(),'poly':poly,'W':W,'H':H,'rect':[0,0,W,H],'coarse':[0,0],'stats':{'inliers':int(keep.sum()),'good':int(len(g)),'patches':int(len(res)),'resid_m':float(np.sqrt((e[keep]**2).mean()))*float(sys.argv[4])}}
json.dump(go,open('georef_out.json','w')); print('saved')
