#!/usr/bin/env python3
"""Copy the playable site into DEST, leaving out the paths listed in .github/pages/exclude.txt."""
import fnmatch, pathlib, shutil, sys
src, dest = pathlib.Path('.').resolve(), pathlib.Path(sys.argv[1]).resolve()
rules = [l.strip() for l in (src / '.github/pages/exclude.txt').read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')]
def excluded(rel):
    for r in rules:
        pat = r.strip('/')
        if r.endswith('/'):                       # directory, anchored at the repository root
            if rel == pat or rel.startswith(pat + '/'): return True
        elif '*' in pat:                          # glob on top-level files only ("/*.md")
            if '/' not in rel and fnmatch.fnmatch(rel, pat): return True
        elif rel == pat:                          # one exact file
            return True
    return False
n = size = 0
for f in sorted(src.rglob('*')):
    rel = f.relative_to(src).as_posix()
    if f.is_dir() or excluded(rel) or f.is_relative_to(dest): continue
    out = dest / rel; out.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(f, out); n += 1; size += f.stat().st_size
(dest / '.nojekyll').touch()
print(f'staged {n} files, {size/1e6:.1f} MB -> {dest}')
