import json, math, numpy as np, sys
from PIL import Image
fid, cpf = sys.argv[1], sys.argv[2]
geo=json.load(open('geo_seibu.json')); cp=json.load(open(cpf))
c=json.load(open('frames.json')); fr={f['id']:f for f in c['frames']}[fid]
W,H=Image.open(f"pages/{fr['page']}.png").size
dx=float(sys.argv[3]) if len(sys.argv)>3 else 0
def merc(lon,lat,z=18):
    n=256*2**z; x=(lon+180)/360*n; r=math.radians(lat); return x,(1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n
P=[];U=[];lab=[]
for k,(x,y) in cp.items():
    if k not in geo: continue
    lon,lat=geo[k][1]; P.append([*merc(lon,lat),1]); U.append([(x+dx)/100*W,y/100*H]); lab.append(k)
P=np.array(P); U=np.array(U); keep=np.ones(len(P),bool)
for _ in range(8):
    A,*_=np.linalg.lstsq(P[keep],U[keep],rcond=None); k=math.sqrt(abs(np.linalg.det(A[:2,:2]))); mpp=156543.03*math.cos(math.radians(35.25))/2**18/k
    e=np.linalg.norm(P@A-U,axis=1)*mpp; nk=e<max(2.5*np.median(e[keep]),60)
    if (nk==keep).all(): break
    keep=nk
print(fid,'n',len(P),'kept',keep.sum(),'rms',round(float(np.sqrt((e[keep]**2).mean())),1),'1:',round(mpp/0.0254*160.6),'out',[l for l,kk in zip(lab,keep) if not kk])
go=json.load(open('georef_out.json'))
go[fid]={'A':A.tolist(),'A0':A.tolist(),'poly':[[x/100*W,y/100*H] for x,y in fr['poly']],'W':W,'H':H,'rect':[0,0,W,H],'coarse':[0,0]}
json.dump(go,open('georef_out.json','w'))
