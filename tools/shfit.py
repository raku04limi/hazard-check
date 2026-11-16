import json, math, numpy as np
from PIL import Image
NAMES={1:'稲沢中学校',2:'明治中学校',3:'千代田中学校',4:'大里中学校',5:'治郎丸中学校',6:'稲沢西中学校',7:'大里東中学校',8:'稲沢東小学校',9:'稲沢西小学校',10:'清水小学校',11:'片原一色小学校',12:'国分小学校',13:'千代田小学校',14:'坂田小学校',15:'大里西小学校',16:'大里東小学校',17:'下津小学校',18:'大塚小学校',19:'稲沢北小学校',20:'髙御堂小学校',21:'小正小学校',24:'稲沢緑風館高等学校',25:'旧稲沢東高等学校',26:'名古屋文理大学文化フォーラム',27:'祖父江中学校',28:'祖父江小学校',29:'山崎小学校',30:'領内小学校',31:'丸甲小学校',32:'牧川小学校',33:'長岡小学校',35:'杏和高等学校',36:'法立小学校',37:'六輪小学校',38:'三宅小学校',39:'平和中学校',40:'平和町体育館'}
NUM={'chubu':{0:19,1:10,3:9,5:30,6:11,7:6,8:2,9:20,10:26,11:18,12:24,13:25,15:4,16:15,17:3,18:13,19:14},
 'seibu':{0:28,1:29,2:10,4:2,5:11,6:30,7:35,8:33,9:32,10:31,11:36,12:38,13:39,14:40,16:37},
 'toubu':{0:5,1:19,2:17,3:8,6:9,7:6,8:21,9:20,10:26,11:18,12:12,13:24,14:25,15:16,16:7,17:4,19:15}}
ic=json.load(open('icons.json')); sk=json.load(open('skhb.json'))
def merc(lon,lat,z=18):
    n=256*2**z; x=(lon+180)/360*n; r=math.radians(lat); return x,(1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*n
go=json.load(open('georef_out.json')); c=json.load(open('frames.json')); frs={f['id']:f for f in c['frames']}
for pg,mp in NUM.items():
    P=[];U=[];lab=[]
    for i,n in mp.items():
        nm=NAMES.get(n); 
        if not nm or nm not in sk: continue
        lon,lat=sk[nm]; x,y,w,h=ic[pg][i]; P.append([*merc(lon,lat),1]); U.append([x,y+h*0.2]); lab.append(n)
    P=np.array(P); U=np.array(U,float); keep=np.ones(len(P),bool)
    for _ in range(8):
        A,*_=np.linalg.lstsq(P[keep],U[keep],rcond=None); k=math.sqrt(abs(np.linalg.det(A[:2,:2]))); mpp=156543.03*math.cos(math.radians(35.25))/2**18/k
        e=np.linalg.norm(P@A-U,axis=1)*mpp; nk=e<max(3*np.median(e[keep]),40)
        if (nk==keep).all(): break
        keep=nk
    print(pg,'n',len(P),'kept',keep.sum(),'rms m',round(float(np.sqrt((e[keep]**2).mean())),1),'scale 1:',round(mpp/0.0254*160.6),'out',[l for l,k_ in zip(lab,keep) if not k_])
    W,H=Image.open(f'pages/{pg}.png').size
    go[pg]={'A':A.tolist(),'A0':A.tolist(),'poly':[[x/100*W,y/100*H] for x,y in frs[pg]['poly']],'W':W,'H':H,'rect':[0,0,W,H],'coarse':[0,0],'stats':{'inliers':int(keep.sum()),'good':int(keep.sum()),'patches':len(P),'resid_m':float(np.sqrt((e[keep]**2).mean()))}}
json.dump(go,open('georef_out.json','w'))
