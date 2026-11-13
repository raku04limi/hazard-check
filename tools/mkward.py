# 区の frames.json を簡潔な指定から作る
import json, sys
S='/tmp/claude-0/-home-user/4a462171-4839-5722-82b5-e32963b69e2d/scratchpad'
MAIN=[8000,9000,10000,11000,12000,13000,14000]; INS=[18000,20000,21000,22000,25000,26000,28000,30000,35000]; TSU=[18000,20000,22000,25000,40000]
TITLE={'kozui':'洪水ハザードマップ','naisui':'内水氾濫ハザードマップ','takashio':'高潮ハザードマップ','jishin':'地震ハザードマップ','hinanjyo':'指定避難所マップ','tameike':'ため池ハザードマップ','tsunami':'津波ハザードマップ'}
CAT={'kozui':'flood','naisui':'naisui','takashio':'takashio','jishin':'jishin','hinanjyo':'hinan','tameike':'tameike','tsunami':'tsunami'}
def make(key, jp, pageid, files, frames, titles={}):
    B=f'https://www.city.nagoya.jp/_res/projects/default_project/_page_/001/036/{pageid[-3:]}'
    pages={p:{'title':titles.get(p, f'{TITLE[p]}（{jp}）'),'category':CAT[p],'source':f'{B}/{fn}'} for p,fn in files.items()}
    fr=[]
    for fid,poly,kind in frames:
        pg=fid.split('-')[0]; d={'id':fid,'page':pg,'poly':poly}
        if kind=='main': d.update(label='',scale=MAIN); 
        if pg in ('kozui','naisui','takashio') and kind=='main': d['legend']='depth'
        if pg=='tameike': d['legend']='tameike'; d['scale']=[8000,10000,12000,13000,15000]
        if kind=='keizoku': d.update(label='浸水継続時間',scale=INS,legend='duration')
        if fid=='jishin': d.update(label='避難場所',scale=MAIN,category='hinan')
        if kind=='shindo': d.update(label='震度',scale=INS,legend='shindo',tolerance=40)
        if kind=='ekijoka': d.update(label='液状化',scale=INS,legend='ekijoka',tolerance=40)
        if fid=='hinanjyo': d.update(label='',scale=MAIN)
        if kind=='chiban': d.update(label='地盤高',scale=INS,category='chikei')
        if fid=='tsunami': d.update(label='津波避難ビル',scale=TSU,category='hinan')
        if kind=='kijun': d.update(label='基準水位',scale=[40000,35000,45000],legend='tsu_kijun')
        if kind=='kaishi': d.update(label='浸水開始時間',scale=[40000,35000,45000],legend='tsu_time')
        fr.append(d)
    json.dump({'key':'nagoya-'+key,'ward':'名古屋市'+jp,'dpi':160.6,'source':f'https://www.city.nagoya.jp/bousaiportal/hazardmap/1036429/{pageid}.html','pages':pages,'frames':fr},open(f'{S}/{key}/frames.json','w'),ensure_ascii=False,indent=1)
