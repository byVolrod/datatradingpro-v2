import re, math, json, sys, html

IMAGES = {
 'light-entree.svg': dict(frame=(1900,8650), boxes={
   'break':(300,1642,1600,2108),'reject':(300,2362,1600,2818),'fakeout':(300,3017,1600,3574),
   'retest':(300,3777,1600,4204),'retest2':(350,5153,1590,5467),'r2r4':(230,6114,1670,6677),
   'tw1':(305,7180,1595,7740),'tw2':(305,8037,1595,8522)}),
 'light-confluences.svg': dict(frame=(4300,2260), boxes={
   'saiso':(110,1290,690,1812),'cot':(800,1490,1400,2030),'dxm':(1500,1230,2100,1490),
   'dxmdash':(1500,1609,2100,1921),'cothist':(800,2114,1400,2256),'diverg':(2210,1203,2790,1497),
   'tendance':(2210,1633,2790,1927),'banques':(2917,1360,3483,1700)}),
 'light-selection.svg': dict(frame=(2000,1250), boxes={}),
 'light-setupaz.svg': dict(frame=(2230,1460), boxes={
   'p1':(1500,110,2160,431),'p2':(1593,560,2068,920),'p3':(1565,1030,2096,1390)}),
 'light-cloture.svg': dict(frame=(1920,4030), boxes={
   'panL':(150,2480,800,2850),'panR':(1180,2299,1800,2650),'panB':(510,3354,1410,3916)}),
 'light-optimisation.svg': dict(frame=(2180,9290), boxes={
   'rr':(950,1547,1150,1796),'slsc':(659,3169,1455,3796),'hs':(707,4372,1389,4628),
   'zi':(852,5071,1252,5349),'x12':(290,6012,1740,6548),'tp':(711,7430,1389,7804)}),
 'light-stratman.svg': dict(frame=(2700,6900), boxes={
   'ch1':(970,753,1730,1178),'ch2':(1405,2119,2165,2551),'ch3':(1405,2809,2165,3241),
   'ch4':(1405,3341,2165,3770),'sl':(325,4106,2305,4815),'entry':(640,5108,2140,5672),
   'final':(620,6104,2120,6776)}),
 'light-setuptypes.svg': dict(frame=(3840,3800), boxes={
   'c1':(265,662,1765,1517),'c2':(2150,663,3550,1518),'c3':(385,1713,1635,2537),
   'c4':(2225,1713,3395,2537),'c5':(1330,2912,2510,3668)}),
 'light-galerie.svg': dict(frame=(2600,2700), boxes={
   'force':(150,320,1250,1311),'baro':(1350,320,2450,1311),'cal':(150,1450,1250,2573),'radar':(1350,1450,2450,2065)}),
}

def attr(s,k):
    m=re.search(k+r'="([^"]*)"',s); return m.group(1) if m else None

def strip_tags(t):
    t = re.sub(r'<br\s*/?>','\n',t)
    t = re.sub(r'<[^>]+>','',t)
    return html.unescape(html.unescape(t))

def bbox(s, tag):
    fs = float(attr(s,'font-size') or attr(s,'data-font-size') or 14)
    if tag=='rect':
        x,y=float(attr(s,'x')),float(attr(s,'y')); w=float(attr(s,'width')); h=float(attr(s,'height'))
        return (x,y,x+w,y+h)
    if tag=='circle':
        cx,cy,r=float(attr(s,'cx')),float(attr(s,'cy')),float(attr(s,'r') or 4)
        return (cx-r,cy-r,cx+r,cy+r)
    if tag=='line':
        x1,y1,x2,y2=[float(attr(s,k)) for k in ('x1','y1','x2','y2')]
        return (min(x1,x2),min(y1,y2),max(x1,x2),max(y1,y2))
    if tag=='text':
        body = strip_tags(re.search(r'>(.*?)</text>', s, re.S).group(1)) if '</text>' in s else (attr(s,'data-content') or '')
        w = len(body)*fs*0.56
        x,y=float(attr(s,'x')),float(attr(s,'y'))
        a = attr(s,'text-anchor') or 'start'
        x0 = x - (w if a=='end' else w/2 if a=='middle' else 0)
        return (x0, y-fs, x0+w, y+fs*0.25)
    if tag=='textArea':
        x,y=float(attr(s,'x')),float(attr(s,'y')); w=float(attr(s,'width') or 300)
        h = attr(s,'height')
        if h: h=float(h)
        else:
            body = strip_tags(re.search(r'>(.*?)</textArea>', s, re.S).group(1)) if '</textArea>' in s else ''
            lines = 0
            for ln in body.split('\n'):
                lines += max(1, math.ceil(len(ln)*fs*0.56 / w)) if ln.strip() else 1
            h = lines*fs*1.4
        return (x,y,x+w,y+h)
    return None

def inter(a,b):
    x0=max(a[0],b[0]); y0=max(a[1],b[1]); x1=min(a[2],b[2]); y1=min(a[3],b[3])
    return (x1-x0, y1-y0) if x1>x0 and y1>y0 else None

def visible(s):
    f=attr(s,'fill'); st=attr(s,'stroke'); tc=attr(s,'data-text-color')
    vals=[v for v in (f,st,tc) if v and v!='none']
    return not (vals and all(v.lower()=='#ffffff' for v in vals))

def load(fname):
    svg=open(fname).read()
    elems=[]
    for m in re.finditer(r'<(rect|circle|line|text|textArea)\b[^>]*?(?:/>|>.*?</\1>)', svg, re.S):
        s=m.group(0); tag=m.group(1)
        if 'data-type="frame"' in s or 'data-deleted' in s: continue
        b=bbox(s,tag)
        if b is None: continue
        elems.append(dict(tag=tag, s=s[:120], id=attr(s,'id') or attr(s,'data-miro-id'), box=b,
                          vis=visible(s), text=tag in ('text','textArea'),
                          content=bool(attr(s,'data-content')), sticky=attr(s,'data-type')=='sticky'))
    return elems

for fname, cfg in IMAGES.items():
    elems = load(fname)
    W,H = cfg['frame']; imgs = cfg['boxes']
    issues=[]
    for e in elems:
        if not e['vis']: continue
        b=e['box']
        if b[0]<-5 or b[1]<-5 or b[2]>W+5 or b[3]>H+5:
            issues.append(('HORS-CADRE', e['tag'], e['id'], [round(v) for v in b]))
        if e['text'] or e['content']:
            for n,ib in imgs.items():
                iv=inter(b,ib)
                if iv and iv[0]>10 and iv[1]>8:
                    issues.append(('SUR-IMAGE', n, e['tag'], e['id'], [round(v) for v in b]))
    texts=[e for e in elems if e['vis'] and e['text']]
    for i in range(len(texts)):
        for j in range(i+1,len(texts)):
            iv=inter(texts[i]['box'],texts[j]['box'])
            if iv and iv[0]>12 and iv[1]>6:
                issues.append(('TXT-TXT', texts[i]['id'], texts[j]['id'], [round(v) for v in texts[i]['box']], [round(v) for v in texts[j]['box']]))
    # centrage des légendes/titres vs images
    for n,ib in imgs.items():
        icx=(ib[0]+ib[2])/2
        for e in texts + [e for e in elems if e['content'] and e['vis']]:
            b=e['box']; cx=(b[0]+b[2])/2
            above = ib[1]-b[3]; below = b[1]-ib[3]
            hover = inter((b[0],ib[1]-1,b[2],ib[3]+1), ib)
            if hover and ((0<=above<=90) or (0<=below<=90)):
                if abs(cx-icx)>18 and (b[2]-b[0]) < (ib[2]-ib[0])*1.3:
                    issues.append(('CENTRAGE', n, e['tag'], e['id'], 'dx=%d' % round(cx-icx)))
    print('=====', fname, '-', len(issues), 'points')
    for it in issues[:24]: print('  ', it)
