#!/usr/bin/env python3
"""Offline install.sh regression: only the HTTP transport is stubbed."""
import hashlib
import os
from pathlib import Path
import subprocess
import tarfile
from tempfile import TemporaryDirectory

INSTALLER = Path(__file__).resolve().parents[1] / 'website/install.sh'
with TemporaryDirectory(prefix='intentflow-test-') as work:
    root = Path(work)
    # Exercise the Darwin arm64 release naming even on the Linux CI runner.
    for name, body in {
        'uname': 'case "$1" in -s) echo Darwin;; -m) echo arm64;; *) exit 1;; esac',
        'sysctl': 'echo 0',
        'curl': '''while [ "$1" != -o ]; do shift; done
case "$3" in
  https://github.com/wlingze/intentflow/releases/latest/download/checksums.txt) cp checksums.txt "$2";;
  https://github.com/wlingze/intentflow/releases/download/v9.8.7/intentflow_9.8.7_darwin_arm64.tar.gz) cp archive "$2";;
  *) echo "Unexpected URL: $3" >&2; exit 1;;
esac''',
    }.items():
        path = root / name
        path.write_text('#!/bin/sh\nset -eu\n' + body + '\n')
        path.chmod(0o755)
    payload = root / 'intentflow'
    payload.write_text('#!/bin/sh\n[ "$1" = --version ] && echo "9.8.7 (fixture)"\n')
    archive = root / 'archive'
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(payload, arcname='./intentflow')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    entry = f'{digest}  intentflow_9.8.7_darwin_arm64.tar.gz\n'
    manifest = root / 'checksums.txt'
    manifest.write_text(entry + entry.replace('arm64', 'amd64'))
    dest = root / 'custom bin' / 'intentflow'
    env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}', TMPDIR=work,
               INTENTFLOW_INSTALL_DIR=str(dest.parent))

    def install():
        return subprocess.run(['sh', INSTALLER], env=env, cwd=root, capture_output=True, text=True)

    result = install()
    assert result.returncode == 0, result.stderr
    assert dest.read_bytes() == payload.read_bytes() and '9.8.7 (fixture)' in result.stdout
    print('ok: resolved latest, downloaded pinned darwin/arm64, installed and ran --version')
    dest.write_text('keep previous installation')
    archive.write_bytes(b'corrupt download')
    result = install()
    assert result.returncode != 0 and 'SHA-256 mismatch' in result.stderr, result
    assert dest.read_text() == 'keep previous installation'
    print('ok: bad SHA-256 rejected before replacement')
    manifest.write_text(entry * 2)
    result = install()
    assert result.returncode != 0 and 'Expected one SHA-256 entry' in result.stderr, result
    assert dest.read_text() == 'keep previous installation'
    print('ok: ambiguous manifest rejected before replacement')
