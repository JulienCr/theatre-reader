#!/usr/bin/env python3
"""Verify a fountain file against the PDF blob: report remaining change regions."""
import xml.etree.ElementTree as ET, re, sys
FOUNTAIN=sys.argv[1] if len(sys.argv)>1 else '/Users/julien.cruau/dev2/theatre-reader/data/tout-le-monde-se-tire/play.fountain'
XML='full.xml'
def nk(s):
    s=s.replace('’',"'").replace('‘',"'").replace(' ',' ').replace(' ',' ').replace(' ',' ')
    s=re.sub(r'\s+',' ',s); s=re.sub(r'\s*…\s*','…',s)
    s=re.sub(r'\)\s*:\s*',') ',s); s=re.sub(r'(\w)-\s+(\w)',r'\1-\2',s)
    return s.strip()
root=ET.parse(XML).getroot()
color={fs.get('id'):fs.get('color') for fs in root.iter('fontspec')}; RED={'#ff1f00'}
def runs(el):
    fid=el.get('font'); br=color.get(fid) in RED; out=[]
    if el.text: out.append((el.text,br))
    for ch in el:
        cr=color.get(ch.get('font',fid)) in RED or br
        if ch.text: out.append((ch.text,cr))
        for g in ch:
            if g.text: out.append((g.text,cr))
            if g.tail: out.append((g.tail,cr))
        if ch.tail: out.append((ch.tail,br))
    return out
pieces=[]
for page in root.iter('page'):
    for t in sorted(page.iter('text'),key=lambda t:(int(t.get('top')),int(t.get('left')))):
        for s,red in runs(t):
            if not red: pieces.append(s)
        pieces.append(' ')
blob=nk(''.join(pieces)); m=re.search(r'ACTE I\.',blob); blob=blob[m.start():] if m else blob
raw=open(FOUNTAIN,encoding='utf-8').read().split('\n')
blocks=[];cur=[]
for ln in raw:
    if ln.strip()=='':
        if cur:blocks.append(cur);cur=[]
    else:cur.append(ln)
if cur:blocks.append(cur)
CUE=re.compile(r"^[A-ZÀ-Ü][A-ZÀ-Ü' .]*$")
fspeech=[]
for bi,b in enumerate(blocks):
    if b[0].startswith(('#','Title:','Author:')): fspeech.append((bi,'#',' '.join(b)))
    elif len(b)>=2 and CUE.match(b[0].strip()): fspeech.append((bi,b[0].strip(),' '.join(b[1:])))
    else: fspeech.append((bi,'~',' '.join(b)))
status=[];last=-1
for bi,sp,text in fspeech:
    k=nk(text)
    if sp=='#' or not k or len(k)<20: status.append((bi,sp,text,'r',None,None)); continue
    idx=blob.find(k)
    if idx!=-1 and idx>=last: status.append((bi,sp,text,'a',idx,idx+len(k))); last=idx+len(k)
    else: status.append((bi,sp,text,'r',None,None))
regions=[];i=0
while i<len(status):
    if status[i][3]=='r':
        j=i
        while j<len(status) and status[j][3]=='r': j+=1
        ps=status[i-1][5] if i>0 and status[i-1][5] is not None else 0
        ns=status[j][4] if j<len(status) and status[j][4] is not None else len(blob)
        regions.append((i,j,ps,ns)); i=j
    else: i+=1
real=[]
for (i,j,ps,ns) in regions:
    sl=blob[ps:ns]
    if any(nk(status[k][2]) and nk(status[k][2]) not in sl and status[k][1]!='#' for k in range(i,j)):
        real.append((i,j,ps,ns))
print(f"{FOUNTAIN}\n  blocks={len(blocks)} anchors={sum(1 for s in status if s[3]=='a')} REAL regions={len(real)}")
for (i,j,ps,ns) in real:
    tags=[f"[{status[k][0]}]{status[k][1]}" for k in range(i,j)]
    print("  region:", ' '.join(tags), "  first:", nk(status[i][2])[:70])
