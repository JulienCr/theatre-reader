#!/usr/bin/env python3
import xml.etree.ElementTree as ET
import re, sys

tree = ET.parse('full.xml')
root = tree.getroot()

# font id -> color
color = {}
for fs in root.iter('fontspec'):
    color[fs.get('id')] = fs.get('color')

RED = {'#ff1f00'}

def runs_of(text_el):
    """Yield (kind, string) where kind in {plain,bold,italic} for a <text> element, in order."""
    fid = text_el.get('font')
    is_red = color.get(fid) in RED
    def emit(s, bold=False, italic=False):
        if s:
            yield ('red' if is_red else ('bold' if bold else ('italic' if italic else 'plain')), s)
    # leading text
    if text_el.text:
        yield from emit(text_el.text)
    for child in text_el:
        bold = child.tag == 'b'
        italic = child.tag == 'i'
        cfid = child.get('font', fid)
        cred = color.get(cfid) in RED
        if child.text:
            k = 'red' if (is_red or cred) else ('bold' if bold else ('italic' if italic else 'plain'))
            yield (k, child.text)
        # nested (b>i etc.)
        for g in child:
            if g.text:
                k = 'red' if (is_red or cred) else ('bold' if bold else 'italic')
                yield (k, g.text)
            if g.tail:
                k = 'red' if (is_red or cred) else ('bold' if bold else ('italic' if italic else 'plain'))
                yield (k, g.tail)
        if child.tail:
            yield from emit(child.tail)

out_lines = []
change_sites = []

for page in root.iter('page'):
    pnum = page.get('number')
    texts = [t for t in page.iter('text')]
    # group into visual lines by top (tolerance), then sort by left
    def top(t): return int(t.get('top'))
    def left(t): return int(t.get('left'))
    texts_sorted = sorted(texts, key=lambda t:(top(t), left(t)))
    # cluster by top within 6px
    lines = []
    cur = []
    cur_top = None
    for t in texts_sorted:
        if cur_top is None or abs(top(t)-cur_top) <= 6:
            cur.append(t); cur_top = top(t) if cur_top is None else cur_top
        else:
            lines.append(cur); cur=[t]; cur_top=top(t)
    if cur: lines.append(cur)

    out_lines.append(f"\n========== PAGE {pnum} ==========")
    for ln in lines:
        ln_sorted = sorted(ln, key=left)
        parts = []
        for t in ln_sorted:
            for kind, s in runs_of(t):
                if kind == 'red':
                    parts.append(('R', s))
                elif kind == 'bold':
                    parts.append(('B', s))
                else:
                    parts.append(('_', s))
        # merge consecutive same-kind
        merged = []
        for k,s in parts:
            if merged and merged[-1][0]==k:
                merged[-1][1]+=s
            else:
                merged.append([k,s])
        rendered = ''
        for k,s in merged:
            if k=='R': rendered += '«R:'+s+'»'
            elif k=='B': rendered += '⟪B:'+s+'⟫'
            else: rendered += s
        rendered = rendered.rstrip()
        if rendered:
            out_lines.append(rendered)
        # record change sites
        linetext = ''.join(s for _,s in merged)
        for k,s in merged:
            if k in ('R','B'):
                change_sites.append((pnum, k, s.strip(), linetext.strip()))

with open('annotated.txt','w') as f:
    f.write('\n'.join(out_lines))

with open('changes.txt','w') as f:
    f.write(f"TOTAL change runs: {len(change_sites)}\n")
    red = [c for c in change_sites if c[1]=='R']
    bold = [c for c in change_sites if c[1]=='B']
    f.write(f"RED runs: {len(red)}   BOLD runs: {len(bold)}\n\n")
    f.write("################ RED (dash markers) ################\n")
    for p,k,s,ctx in red:
        f.write(f"\n[p{p}] RED={s!r}\n   ctx: {ctx}\n")
    f.write("\n\n################ BOLD (heavy rewrites) ################\n")
    for p,k,s,ctx in bold:
        f.write(f"\n[p{p}] BOLD={s!r}\n   ctx: {ctx}\n")

print("wrote annotated.txt and changes.txt")
print(f"red={len([c for c in change_sites if c[1]=='R'])} bold={len([c for c in change_sites if c[1]=='B'])}")
