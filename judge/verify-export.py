#!/usr/bin/env python3
"""Verify the tracked distribution of this export against EXPORT-MANIFEST.json: every listed file exists with its recorded hash, no unlisted tracked file exists, no denied names, no secret-shaped content. Local-only folders (run/, node_modules/, .venv/, models/, judge.env, .git/) are outside the distribution and are not claimed clean by this check. Read-only."""
import hashlib, json, re, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'EXPORT-MANIFEST.json').read_text())
patterns = [re.compile(p.encode()) for p in manifest['secretScan']['patterns']]
reviewed = {k: {e['sha256'] for e in v} for k, v in manifest['secretScan'].get('reviewedFixtureStrings', {}).items()}
deny = re.compile(manifest['secretScan']['deniedNames'], re.I)
problems = []
listed = {f['path'] for f in manifest['files']}
for f in manifest['files']:
    p = root / f['path']
    if not p.is_file(): problems.append(f"missing {f['path']}"); continue
    if hashlib.sha256(p.read_bytes()).hexdigest() != f['exportedSha256']: problems.append(f"hash mismatch {f['path']}")
for p in root.rglob('*'):
    if p.is_dir() or any(part in ('.git', 'node_modules', '.venv', 'run', 'models') for part in p.relative_to(root).parts): continue
    rel = p.relative_to(root).as_posix()
    if rel in ('EXPORT-MANIFEST.json', 'judge.env'): continue
    if rel not in listed: problems.append(f'unlisted file {rel}')
    if deny.search(rel) and rel not in manifest['secretScan'].get('approvedPublicMediaPaths', []): problems.append(f'denied name {rel}')
    if p.suffix.lower() in ('.png', '.m4a', '.jpg', '.jpeg', '.pdf', '.mp4'): continue
    data = p.read_bytes()
    for pat in patterns:
        for m in pat.finditer(data):
            if hashlib.sha256(m.group(0)).hexdigest() not in reviewed.get(rel, set()): problems.append(f'secret-shaped content in {rel}'); break
print(json.dumps({'files': len(manifest['files']), 'problems': problems}, indent=2))
sys.exit(1 if problems else 0)
