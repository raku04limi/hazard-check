import numpy as np, cv2, json, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
n=sys.argv[1] if len(sys.argv)>1 else 'h12'
T=json.load(open('h2hinan.json'))
Hg=np.asarray(Image.open(f'pages/{n}.png').convert('L')).astype(np.float32)
Cg=np.asarray(Image.open('pages/hinan.png').convert('L')).astype(np.float32)
hh,hw=Cg.shape
def feat(a,s): 
    gx=cv2.Sobel(a,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(a,cv2.CV_32F,0,1,ksize=3)
    return cv2.GaussianBlur(np.minimum(np.hypot(gx,gy),150)/150,(0,0),s)
M=np.array([[T['s'],0,T['tx']],[0,T['s'],T['ty']]],np.float32)
for it in range(4):
    Wp=cv2.warpAffine(Hg,M,(hw,hh),flags=cv2.INTER_AREA,borderValue=255)
    FA=feat(Wp,2.0); FB=feat(Cg,2.0)
    P=160; R=30 if it<2 else 10; res=[]
    for y in range(int(.2*hh),int(.95*hh)-P,P//2):
        for x in range(int(.05*hw),int(.68*hw)-P,P//2):
            t=FA[y:y+P,x:x+P]
            if t.std()<0.05: continue
            s=FB[y-R:y+P+R,x-R:x+P+R]
            if s.shape!=(P+2*R,P+2*R): continue
            r=cv2.matchTemplate(s,t,cv2.TM_CCOEFF_NORMED); _,mv,_,ml=cv2.minMaxLoc(r)
            r2=r.copy(); r2[max(0,ml[1]-4):ml[1]+5,max(0,ml[0]-4):ml[0]+5]=-1
            res.append((x+P/2,y+P/2,ml[0]-R,ml[1]-R,mv,mv-r2.max()))
    res=np.array(res); g=res[(res[:,4]>0.2)&(res[:,5]>0.02)]
    pts=g[:,:2]; d=g[:,2:4]; keep=np.ones(len(g),bool)
    for _ in range(10):
        C,*_=np.linalg.lstsq(np.c_[pts[keep],np.ones(keep.sum())],d[keep],rcond=None)
        e=np.linalg.norm(np.c_[pts,np.ones(len(pts))]@C-d,axis=1); nk=e<max(3*np.median(e[keep]),2.5)
        if (nk==keep).all(): break
        keep=nk
    print(n,'it',it,'patches',len(res),'good',len(g),'inl',keep.sum(),'med shift px',round(float(np.median(np.linalg.norm(d[keep],axis=1))),1),'resid px',round(float(np.sqrt((e[keep]**2).mean())),2))
    # new mapping: H -> hinan  : point p maps to M p, true location = M p + d(Mp)
    src=[];dst=[]
    for yy in np.linspace(.25*hh,.9*hh,12):
        for xx in np.linspace(.1*hw,.65*hw,12):
            q=np.array([xx,yy]); dq=np.array([xx,yy,1])@C
            Mi=cv2.invertAffineTransform(M); p=Mi@np.array([xx,yy,1])
            src.append(p); dst.append(q+dq)
    M=cv2.estimateAffine2D(np.array(src,np.float32),np.array(dst,np.float32))[0].astype(np.float32)
json.dump({'M':M.tolist(),'inl':int(keep.sum()),'resid_px':float(np.sqrt((e[keep]**2).mean()))},open(f'h2hinan_{n}.json','w'))
