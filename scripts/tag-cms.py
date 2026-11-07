#!/usr/bin/env python3
"""One-off: add data-cms="<key>" to text-only headings/paragraphs of the public pages so the admin can edit them.
Adds attributes only; visible content is unchanged. Safe to re-run (already tagged elements are skipped)."""
import re, glob, os, collections
PAGES = {'index':'home'}
pat = re.compile(r'<(h1|h2|h3|p)((?:\s[^>]*)?)>([^<]{3,})</\1>')
tot = 0
for f in sorted(glob.glob('*.html')):
    if f in ('admin.html','block-factory.html') : pass
    if f == 'admin.html': continue
    s = open(f, encoding='utf-8').read()
    page = PAGES.get(f[:-5], f[:-5])
    n = collections.Counter()
    # keys already used on the page (re-run safety)
    for m in re.finditer(r'data-cms="[^"]*\.(h1|h2|h3|p)\.(\d+)"', s): n[m.group(1)] = max(n[m.group(1)], int(m.group(2)))
    def sub(m):
        global tot
        tag, attrs, text = m.groups()
        if 'data-cms' in attrs or '{{' in text or text.strip().startswith('&') and len(text) < 8: return m.group(0)
        n[tag] += 1; tot += 1
        return f'<{tag}{attrs} data-cms="{page}.{tag}.{n[tag]}">{text}</{tag}>'
    out = pat.sub(sub, s)
    if out != s: open(f, 'w', encoding='utf-8').write(out)
    print(f, sum(n.values()))
print('tagged', tot)
