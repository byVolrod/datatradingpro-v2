import re, sys, json, os

# ---- mapping sombre -> clair (DTP blanc : or #e3b23a / #b8860b, cartes gris perle, texte encre)
FILL = {
 '#0d0e11':'#ffffff', '#0a0a0c':'#ffffff',
 '#16171b':'#f6f7f9', '#131418':'#f3f4f6', '#101014':'#f6f7f9', '#121214':'#f3f4f6', '#101114':'#f6f7f9',
 '#0e2b1d':'#e3f7ec', '#0e2a1c':'#e3f7ec',
 '#33140e':'#fde9e2', '#2e1310':'#fde9e2', '#331612':'#fde9e2',
 '#14203a':'#e8effc',
 '#d7dae0':'#3f434e', '#d7d9e0':'#3f434e', '#cfd2da':'#3f434e',
 '#eceef2':'#16181f', '#9a9aa4':'#5f626e',
}
STROKE = {
 '#26272c':'#e2e3e8', '#23242a':'#e2e3e8', '#2a2b31':'#e2e3e8', '#26262c':'#e2e3e8', '#232429':'#e2e3e8',
 '#3a3b42':'#c9ccd4', '#1c1c20':'#e2e3e8', '#111113':'#e8e9ee', '#6a6b72':'#b9bcc4', '#6d6e78':'#b9bcc4',
 '#d7dae0':'#3f434e', '#d7d9e0':'#3f434e', '#cfd2da':'#3f434e', '#eceef2':'#3f434e', '#9a9aa4':'#5f626e',
 '#0d0e11':'#ffffff', '#131418':'#f3f4f6', '#16171b':'#f6f7f9', '#101014':'#f6f7f9', '#2a2b31':'#e2e3e8', '#b02c00':'#b02c00',
}
TXT = { '#eceef2':'#16181f', '#9a9aa4':'#5f626e', '#0d0e11':'#ffffff' }
CARD_FILLS = {'#16171b','#131418','#101014','#121214','#101114'}

def attr(s, k):
    m = re.search(k + r'="([^"]*)"', s)
    return m.group(1) if m else None

def setattr_(s, k, v):
    if re.search(k + r'="[^"]*"', s):
        return re.sub(k + r'="[^"]*"', f'{k}="{v}"', s)
    return s

def center(s, tag):
    if tag == 'circle':
        cx, cy = attr(s,'cx'), attr(s,'cy')
        return (float(cx), float(cy)) if cx and cy else None
    if tag == 'line':
        x1,y1,x2,y2 = [attr(s,k) for k in ('x1','y1','x2','y2')]
        if x1: return ((float(x1)+float(x2))/2, (float(y1)+float(y2))/2)
        return None
    x, y = attr(s,'x'), attr(s,'y')
    if x is None or y is None: return None
    w = attr(s,'width'); h = attr(s,'height')
    fx, fy = float(x), float(y)
    if w and h: return (fx+float(w)/2, fy+float(h)/2)
    return (fx, fy)

def inside(pt, boxes):
    if pt is None: return False
    for (x0,y0,x1,y1) in boxes:
        if x0 <= pt[0] <= x1 and y0 <= pt[1] <= y1: return True
    return False

def is_panel(s, tag):
    if tag != 'rect': return False
    f = attr(s,'fill')
    w, h = attr(s,'width'), attr(s,'height')
    return f in CARD_FILLS and w and h and float(w) >= 300 and float(h) >= 200

def whiten(s, tag):
    s = setattr_(s, 'fill', '#ffffff')
    if attr(s,'stroke') not in (None,'none'): s = setattr_(s, 'stroke', '#ffffff')
    if attr(s,'data-text-color'): s = setattr_(s, 'data-text-color', '#ffffff')
    s = re.sub(r'stroke-dasharray="[^"]*"', '', s)
    return s

def recolor(s, tag):
    f = attr(s,'fill')
    if f:
        if tag in ('text','textArea') and f.lower() == '#e3b23a':
            s = setattr_(s,'fill','#b8860b')
        elif f in FILL:
            s = setattr_(s,'fill',FILL[f])
    st = attr(s,'stroke')
    if st and st in STROKE: s = setattr_(s,'stroke',STROKE[st])
    tc = attr(s,'data-text-color')
    if tc and tc in TXT: s = setattr_(s,'data-text-color',TXT[tc])
    return s

def process(seg, boxes):
    out = []
    # frame rect
    def one(m):
        tag = m.group(1); s = m.group(0)
        if 'data-type="frame"' in s:
            return setattr_(s,'fill','#ffffff')
        if attr(s,'data-type') == 'sticky': return s
        if tag == 'image' or 'data-type="image"' in s: return s
        pt = center(s, tag)
        if inside(pt, boxes) and not is_panel(s, tag):
            return whiten(s, tag)
        return recolor(s, tag)
    seg = re.sub(r'<(rect|circle|line|text|textArea|image)\b[^>]*?/?>', lambda m: one(m), seg)
    # textArea bodies keep; also handle <text ...>body</text> fill already done via attrs
    return seg

def extract_group(svg, frame_id):
    m = re.search(r'<g [^>]*data-miro-id="%s"[^>]*>' % frame_id, svg)
    start = m.start()
    end = svg.index('</g>', start)
    return svg[start:end] + '</g>'

if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    src = open(cfg['source']).read()
    if cfg.get('json_svg'):
        src = json.loads(src)['result_svg']
    seg = extract_group(src, cfg['frame_id'])
    # force transform correct
    seg = re.sub(r'^<g ([^>]*)transform="translate\([^"]*\)"', r'<g \1transform="translate(%s)"' % cfg['transform'], seg)
    body = process(seg, [tuple(b) for b in cfg['boxes']])
    out = '<svg xmlns="http://www.w3.org/2000/svg">\n' + body + '\n</svg>'
    open(cfg['out'],'w').write(out)
    import xml.dom.minidom
    xml.dom.minidom.parseString(out)
    n = len(re.findall(r'data-miro-id', out))
    print(cfg['out'], 'ok,', n, 'ids,', len(out), 'chars')
