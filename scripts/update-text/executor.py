#!/usr/bin/env python3
"""Apply author changes: keep unchanged speeches verbatim, auto-reconstruct dialogue regions
from the red-stripped PDF. Complex regions (stage directions/headings) are left for manual edit."""
import xml.etree.ElementTree as ET
import re, sys

FOUNTAIN='/Users/julien.cruau/dev2/theatre-reader/data/tout-le-monde-se-tire/play.fountain'
XML='full.xml'
SPEAKERS=['NARRATEUR','GERALD','BREVIER','GIUSEPPE','BENJI','MICHEL','SIMONE','LILIANE','DESIREE','DIRECTEUR','VOIX JOURNAL','VOIX','TOUS']
MANUAL_SKIP={9,28,32,33,61,62,74,75,77,80}   # stage-dir/heading/garbled-bold regions — edited by hand afterwards

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

# fountain blocks
raw=open(FOUNTAIN,encoding='utf-8').read().split('\n')
blocks=[];cur=[]
for ln in raw:
    if ln.strip()=='':
        if cur:blocks.append(cur);cur=[]
    else:cur.append(ln)
if cur:blocks.append(cur)
CUE=re.compile(r"^[A-ZÀ-Ü][A-ZÀ-Ü' .]*$")
def block_kind_text(b):
    if b[0].startswith(('#','Title:','Author:')): return ('#',' '.join(b))
    if len(b)>=2 and CUE.match(b[0].strip()): return (b[0].strip(),' '.join(b[1:]))
    return ('~',' '.join(b))

fspeech=[block_kind_text(b) for b in blocks]

# anchors
status=[]
last_end=-1
for bi,(sp,text) in enumerate(fspeech):
    k=nk(text)
    if sp=='#' or not k or len(k)<20:
        status.append([bi,sp,text,'region',None,None]); continue
    idx=blob.find(k)
    if idx!=-1 and idx>=last_end:
        status.append([bi,sp,text,'anchor',idx,idx+len(k)]); last_end=idx+len(k)
    else:
        status.append([bi,sp,text,'region',None,None])

# raw regions
regions=[]
i=0
while i<len(status):
    if status[i][3]=='region':
        j=i
        while j<len(status) and status[j][3]=='region': j+=1
        prev_end=status[i-1][5] if i>0 and status[i-1][5] is not None else 0
        next_start=status[j][4] if j<len(status) and status[j][4] is not None else len(blob)
        regions.append((i,j,prev_end,next_start)); i=j
    else: i+=1

# keep only real-change regions, numbered like the report
real=[]
for (i,j,ps,ns) in regions:
    sl=blob[ps:ns]
    if any(nk(status[k][2]) and nk(status[k][2]) not in sl and status[k][1]!='#' for k in range(i,j)):
        real.append((i,j,ps,ns))

# a cue = SPEAKER followed by EITHER a parenthetical (colon optional, nk strips it) OR a bare colon
cue_re=re.compile(r'\b('+'|'.join(re.escape(s) for s in sorted(SPEAKERS,key=len,reverse=True))+r')(?:(\s*\([^)]*\))\s*:?\s*|\s*:\s*)')
def reconstruct(slice_txt):
    """slice -> list of fountain blocks [[cue,dialogue],...]; drop empty bodies (boundary cue)."""
    cues=list(cue_re.finditer(slice_txt))
    out=[]
    pre=slice_txt[:cues[0].start()].strip() if cues else slice_txt.strip()
    if pre: out.append(('PRE',pre))
    for idx,c in enumerate(cues):
        sp=c.group(1); did=(c.group(2) or '').strip()
        body=slice_txt[c.end(): cues[idx+1].start() if idx+1<len(cues) else len(slice_txt)].strip()
        dialogue=((did+' ') if did else '')+body
        dialogue=dialogue.strip()
        if not dialogue: continue          # boundary/next-anchor empty cue
        out.append((sp,dialogue))
    return out

def curly(s):
    return s.replace("'", "’")

region_at={}
for n,(i,j,ps,ns) in enumerate(real,1):
    region_at[i]=(n,i,j,ps,ns)

# emit new fountain
region_span={i:(i,j) for (i,j,ps,ns) in real}
skip_until=-1
out_blocks=[]
manual_left=[]
n_auto=0
for idx,b in enumerate(blocks):
    if idx<skip_until: continue
    if idx in region_at:
        n,i,j,ps,ns=region_at[idx]
        skip_until=j
        if n in MANUAL_SKIP:
            for k in range(i,j): out_blocks.append(blocks[k])   # keep original
            manual_left.append((n,blocks[i][0] if blocks[i] else '', i, j))
            continue
        sl=blob[ps:ns]
        rec=reconstruct(sl)
        n_auto+=1
        for sp,dialogue in rec:
            if sp=='PRE':
                # cue-less leading text = author appended to the previous (anchor) speech -> merge
                if out_blocks and len(out_blocks[-1])>=2:
                    out_blocks[-1][-1]=out_blocks[-1][-1].rstrip()+' '+curly(dialogue)
                else:
                    out_blocks.append([curly(dialogue)])
            else:
                out_blocks.append([sp, curly(dialogue)])
    else:
        out_blocks.append(b)

new_text='\n\n'.join('\n'.join(bl) for bl in out_blocks)+'\n'
open(FOUNTAIN+'.new','w',encoding='utf-8').write(new_text)
print(f"real regions={len(real)}  auto-reconstructed={n_auto}  manual-skipped={len(MANUAL_SKIP)}")
print("manual regions still original:", [m[0] for m in manual_left])
print("wrote", FOUNTAIN+'.new')
