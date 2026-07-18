#!/usr/bin/env python3
"""Segment the marked-up PDF (pdftohtml -xml) into ordered UNITS: heading / stagedir / speech.
Red runs (author marker dashes) are stripped. Reusable across texts."""
import xml.etree.ElementTree as ET
import re

SPEAKERS = ['NARRATEUR','GERALD','BREVIER','GIUSEPPE','BENJI','MICHEL','SIMONE',
            'LILIANE','DESIREE','DIRECTEUR','VOIX JOURNAL','VOIX','TOUS']

def norm_disp(s):
    s=s.replace(' ',' ').replace(' ',' ').replace(' ',' ')
    return re.sub(r'\s+',' ',s).strip()

def load_runs(xml):
    """Yield (text, red, italic) runs across the whole document, in reading order, from ACTE I."""
    root=ET.parse(xml).getroot()
    color={fs.get('id'):fs.get('color') for fs in root.iter('fontspec')}
    RED={'#ff1f00'}
    runs=[]
    for page in root.iter('page'):
        for el in sorted(page.iter('text'),key=lambda t:(int(t.get('top')),int(t.get('left')))):
            fid=el.get('font'); base_red=color.get(fid) in RED
            def add(t,red,ital):
                if t: runs.append((t,red,ital))
            if el.text: add(el.text,base_red,False)
            for ch in el:
                tag=ch.tag; cred=color.get(ch.get('font',fid)) in RED or base_red
                ital = (tag=='i')
                if ch.text: add(ch.text,cred, ital)
                for g in ch:  # nested <b><i>
                    gital = ital or (g.tag=='i')
                    if g.text: add(g.text,cred,gital)
                    if g.tail: add(g.tail,cred,ital)
                if ch.tail: add(ch.tail,base_red,False)
            runs.append((' ',False,False))  # line break -> space
    return runs

def build_units(xml):
    runs=load_runs(xml)
    # 1) strip red; classify each CHAR: stage-direction = italic AND outside parentheses.
    #    (inline didascalies live inside parens; standalone stage directions do not)
    segs=[]  # list of ['SD', text] or ['T', text]
    depth=0
    for text,red,ital in runs:
        if red: continue
        for c in text:
            if c=='(':
                kind='T'; depth+=1
            elif c==')':
                kind='T'; depth=max(0,depth-1)
            else:
                kind='SD' if (ital and depth==0) else 'T'
            if segs and segs[-1][0]==kind:
                segs[-1][1]+=c
            else:
                segs.append([kind,c])
    # start at ACTE I
    full=''.join(s[1] for s in segs)
    # 2) turn segments into ordered units
    cue_re=re.compile(r'\s*\b('+'|'.join(re.escape(s) for s in sorted(SPEAKERS,key=len,reverse=True))+r')((?:\s*\([^)]*\))?)\s*:\s*')
    head_re=re.compile(r'\b((?:ACTE|SCENE|SCÈNE|INTERLUDE)[^.]*\.(?:\s*(?:SCENE|SCÈNE)[^.]*\.)?)',re.I)
    units=[]
    started=[False]
    def maybe_start(t):
        if started[0]: return t
        m=re.search(r'ACTE I\.',t)
        if m: started[0]=True; return t[m.start():]
        return None
    for kind,text in segs:
        if kind=='SD':
            t=norm_disp(text)
            if not started[0]:
                continue
            if t: units.append(('SD','',t))
            continue
        # T segment: may contain headings + multiple cues
        t=maybe_start(text)
        if t is None: continue
        # split by cue positions, but also pull headings out
        # find all cue matches
        pos=0
        cues=list(cue_re.finditer(t))
        if not cues:
            tt=norm_disp(t)
            if tt: units.append(('TXT','',tt))
            continue
        # text before first cue = leftover (stage direction remnant / heading)
        pre=norm_disp(t[:cues[0].start()])
        if pre:
            units.append(('TXT','',pre))
        for i,c in enumerate(cues):
            sp=c.group(1); did=norm_disp(c.group(2) or '')
            body=t[c.end(): cues[i+1].start() if i+1<len(cues) else len(t)]
            body=norm_disp(body)
            dialogue=(did+' ' if did else '')+body
            units.append(('SP',sp,norm_disp(dialogue)))
    # 3) split headings out of TXT units
    final=[]
    for u in units:
        if u[0]=='TXT':
            parts=head_re.split(u[2])
            for p in parts:
                p=norm_disp(p)
                if not p: continue
                if head_re.fullmatch(p):
                    final.append(('#','',p))
                else:
                    final.append(('SD','',p))
        else:
            final.append(u)
    return final

if __name__=='__main__':
    u=build_units('full.xml')
    from collections import Counter
    print('units:',len(u), Counter(x[0] for x in u))
    for x in u[:40]:
        print(f"[{x[0]}] {x[1]}: {x[2][:90]}")
