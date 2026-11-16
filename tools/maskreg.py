import numpy as np, cv2, json, math
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
def hmask(n):
    g=np.asarray(Image.open(f'pages/{n}.png').convert('L')); H,W=g.shape
    m=(g<215).astype(np.uint8); m[:int(.2*H)]=0; m[int(.75*H):,int(.7*W):]=0; m[:, :int(.03*W)]=0; m[:, int(.97*W):]=0; m[int(.95*H):]=0
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((25,25),np.uint8))
    cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); c=max(cs,key=cv2.contourArea)
    out=np.zeros_like(m); cv2.drawContours(out,[c],-1,1,-1); return out
def cmask():
    im=np.asarray(Image.open('pages/hinan.png').convert('RGB')).astype(int); H,W,_=im.shape
    r,g,b=im[...,0],im[...,1],im[...,2]; mx=im.max(2); mn=im.min(2)
    m=((mx-mn)>18)&(mx>200)&~((b>r+40)&(b>g))  # pastel districts, not blue water
    m=m.astype(np.uint8); m[:, int(.695*W):]=0; m[:int(.15*H)]=0
    m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((5,5),np.uint8)); m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((31,31),np.uint8))
    cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); c=max(cs,key=cv2.contourArea)
    out=np.zeros_like(m); cv2.drawContours(out,[c],-1,1,-1); return out
if __name__=='__main__':
    A=hmask('h12'); B=cmask()
    Image.fromarray(A*255).resize((A.shape[1]//6,A.shape[0]//6)).save('m_h12.png'); Image.fromarray(B*255).resize((B.shape[1]//6,B.shape[0]//6)).save('m_hinan.png')
    def bbox(m): ys,xs=np.where(m); return xs.min(),ys.min(),xs.max(),ys.max(),m.sum()
    print(bbox(A),bbox(B))
