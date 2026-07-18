#!/usr/bin/env python3
"""Change-region diff: anchor unchanged fountain speeches into the red-stripped PDF blob;
everything between anchors is a change region shown as OLD (fountain) vs NEW (pdf slice)."""
import xml.etree.ElementTree as ET
import re, difflib

FOUNTAIN='/Users/julien.cruau/dev2/theatre-reader/data/tout-le-monde-se-tire/play.fountain'
XML='full.xml'
SPEAKERS=['NARRATEUR','GERALD','BREVIER','GIUSEPPE','BENJI','MICHEL','SIMONE','LILIANE','DESIREE','DIRECTEUR','VOIX JOURNAL','VOIX','TOUS']

def nk(s):
    s=s.replace('’',"'").replace('‘',"'").replace(' ',' ').replace(' ',' ').replace(' ',' ')
    s=re.sub(r'\s+',' ',s)
    s=re.sub(r'\s*…\s*','…',s)
    s=re.sub(r'\)\s*:\s*',') ',s)
    s=re.sub(r'(\w)-\s+(\w)',r'\1-\2',s)
    return s.strip()

# blob
root=ET.parse(XML).getroot()
color={fs.get('id'):fs.get('color') for fs in root.iter('fontspec')}
RED={'#ff1f00'}
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
blob=nk(''.join(pieces))
m=re.search(r'ACTE I\.',blob); blob=blob[m.start():] if m else blob

# fountain speeches
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
    if b[0].startswith(('#','Title:','Author:')):
        fspeech.append((bi,'#',' '.join(b))); continue
    if len(b)>=2 and CUE.match(b[0].strip()):
        fspeech.append((bi,b[0].strip(),' '.join(b[1:])))
    else:
        fspeech.append((bi,'~',' '.join(b)))

# anchor: leftmost find for long-enough speeches, keep only monotonically increasing positions
status=[]  # (bi,speaker,text,kind,start,end)
last_end=-1
for bi,sp,text in fspeech:
    k=nk(text)
    if sp=='#' or not k or len(k)<20:
        status.append((bi,sp,text,'region',None,None)); continue
    idx=blob.find(k)
    if idx!=-1 and idx>=last_end:
        status.append((bi,sp,text,'anchor',idx,idx+len(k)))
        last_end=idx+len(k)
    else:
        status.append((bi,sp,text,'region',None,None))

cue_re=re.compile(r'\s*\b('+'|'.join(re.escape(s) for s in sorted(SPEAKERS,key=len,reverse=True))+r')((?:\s*\([^)]*\))?)\s*:\s*')
def split_new(slice_txt):
    slice_txt=slice_txt.strip()
    cues=list(cue_re.finditer(slice_txt))
    out=[]
    if not cues:
        if slice_txt: out.append(('?',slice_txt))
        return out
    pre=slice_txt[:cues[0].start()].strip()
    if pre: out.append(('(pré)',pre))
    for i,c in enumerate(cues):
        body=slice_txt[c.end(): cues[i+1].start() if i+1<len(cues) else len(slice_txt)].strip()
        did=(c.group(2) or '').strip()
        out.append((c.group(1),(did+' ' if did else '')+body))
    return out

# group consecutive region items
regions=[]
i=0
while i<len(status):
    if status[i][3]=='region':
        j=i
        while j<len(status) and status[j][3]=='region': j+=1
        # bounds
        prev_end = status[i-1][5] if i>0 and status[i-1][5] is not None else 0
        next_start = status[j][4] if j<len(status) and status[j][4] is not None else len(blob)
        regions.append((i,j,prev_end,next_start))
        i=j
    else:
        i+=1

real=[]
for (i,j,ps,ns) in regions:
    sl=blob[ps:ns]
    changed=False
    for k in range(i,j):
        bi,sp,text,kind,_,_=status[k]
        key=nk(text)
        if sp=='#': continue
        if key and key not in sl:
            changed=True; break
    if changed:
        real.append((i,j,ps,ns))

out=[f"anchors={sum(1 for s in status if s[3]=='anchor')}  raw_regions={len(regions)}  REAL_CHANGE_regions={len(real)}  (of {len(fspeech)} blocks)\n"]
for n,(i,j,ps,ns) in enumerate(real,1):
    out.append("\n"+"="*100)
    old=[status[k] for k in range(i,j)]
    b0=old[0][0]; b1=old[-1][0]
    out.append(f"REGION {n}  — fountain blocks {b0}..{b1}")
    out.append("  OLD (fountain):")
    for k in range(i,j):
        bi,sp,text,kind,_,_=status[k]
        out.append(f"    [{bi}] {sp}: {nk(text)}")
    sl=blob[ps:ns]
    out.append("  NEW (pdf):")
    for spk,txt in split_new(sl):
        out.append(f"    {spk}: {txt}")
with open('regions_report.txt','w') as f: f.write('\n'.join(out))
print(out[0])
print("wrote regions_report.txt")
