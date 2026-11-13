#!/usr/bin/env python3
"""Stamp build.json and index.html with a deploy id (commit SHA or --id).

GitHub's OAuth token in this environment cannot push workflow-file changes,
so the Pages workflow is left alone. Run this before a Pages deploy, or
rely on the committed build.json id (bump it when index.html itself changes).
Legacy scripts already load with cache:'no-store', so a JS-only deploy
reaches the client even if the HTML id is unchanged.
"""
import argparse, datetime, json, os, pathlib, re, subprocess, sys

def git_sha():
    try:
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    except Exception:
        return os.environ.get('GITHUB_SHA', '')

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--id', default='')
    p.add_argument('--root', default='.')
    args = p.parse_args()
    root = pathlib.Path(args.root)
    sha = git_sha()
    short = args.id or (sha[:12] if sha else 'dev')
    data = {
        'id': short,
        'sha': sha,
        'time': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    (root / 'build.json').write_text(json.dumps(data, indent=2) + '\n')
    html_path = root / 'index.html'
    html = html_path.read_text()
    html2, n = re.subn(
        r'window\.__SIN_BUILD__\s*=\s*["\'][^"\']*["\']',
        'window.__SIN_BUILD__ = "%s"' % short,
        html,
        count=1,
    )
    if n != 1:
        sys.exit('failed to stamp index.html (replacements=%s)' % n)
    html_path.write_text(html2)
    print('stamped', short)

if __name__ == '__main__':
    main()
