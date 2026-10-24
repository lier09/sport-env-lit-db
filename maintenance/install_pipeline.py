"""Hash-guarded, backed-up offline installation. Preflight is the default.

Run only in Muse's actual workspace, with schedulers paused during this brief
operation. Never copies data, credentials, old site templates or public files.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
from contextlib import ExitStack

HERE = Path(__file__).resolve().parent

LEGACY_PAGINATION_BLOCKS = {
    'Repeated paper IDs; pagination coverage not established',
    'Live result count changed during pagination; review/restart this query with a new run scope',
    'Short page before declared total; query is incomplete',
    'Missing or repeated pagination cursor',
}


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def install(workspace, state, execute=False, accept_pending_replay=False):
    workspace, state = Path(workspace).resolve(), Path(state).resolve()
    manifest = json.loads((HERE/'pipeline'/'INSTALL_MANIFEST.json').read_text(encoding='utf-8'))
    spec = importlib.util.spec_from_file_location('installer_runner', workspace/'cold-lit-db'/'run_pipeline.py')
    sys.path.insert(0, str(workspace/'cold-lit-db'))
    runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
    with ExitStack() as stack:
        # Same lock order as the managed entry point.
        for name in ('enqueue.lock', 'writer.lock'):
            if not stack.enter_context(runner.lock(state/name)):
                raise ValueError('Writer/enqueue active; defer installation')
        if (state/'write-transaction.json').exists():
            raise ValueError('Recover interrupted data transaction with current runtime first')
        for item in manifest['files']:
            relative = Path(item['path'])
            if relative.is_absolute() or '..' in relative.parts: raise ValueError('Unsafe install path')
            src, dst = HERE/'pipeline'/relative, workspace/relative
            if sha(src) != item['sha256']: raise ValueError('Patch payload hash mismatch')
            current = sha(dst) if dst.exists() else None
            if current not in (item['expected_before'], item['sha256']):
                raise ValueError('Installed file changed; inspect diff before install: ' + relative.as_posix())
        queues = []
        for path in (state/'queue').glob('*.json'):
            item = json.loads(path.read_text(encoding='utf-8'))
            if item.get('status') != 'complete':
                if Path(item.get('workspace', '')).resolve() != workspace:
                    raise ValueError('Pending queue belongs to a different workspace; do not replay an exported snapshot')
                if item.get('job') == 'rewash':
                    raise ValueError('Archive old rewash queue after review; historical discovery replaces it')
                if not accept_pending_replay:
                    raise ValueError('Pending scopes need --accept-pending-replay after reviewing preserved windows/pages')
                if item.get('status') == 'blocked' and item.get('error') in LEGACY_PAGINATION_BLOCKS:
                    pass  # v2 pagination failures are recoverable with v3 query quarantine.
                elif item.get('status') not in ('pending', 'running'):
                    raise ValueError('Resolve blocked queue before installation')
                queues.append((path, item))
        summary = {'status': 'preflight_passed', 'files': len(manifest['files']),
                   'pending_scopes_to_replay': len(queues), 'data_modified': False, 'uploaded': False}
        if not execute: return summary
        backup = workspace/'pipeline-backups'/dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        backup.mkdir(parents=True)
        originals = []
        for item in manifest['files']:
            dst = workspace/item['path']; old = backup/item['path']
            if dst.exists():
                old.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(dst, old)
            originals.append((dst, old if dst.exists() else None))
        for path, _ in queues:
            old = backup/'queue'/path.name; old.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, old)
        try:
            for item in manifest['files']:
                dst = workspace/item['path']; dst.parent.mkdir(parents=True, exist_ok=True)
                tmp = dst.with_name(dst.name+'.install.tmp')
                shutil.copy2(HERE/'pipeline'/item['path'], tmp); os.replace(tmp, dst)
            # Load updated source fingerprint logic, preserving original scope,
            # frozen date window and all durable raw-page caches.
            spec = importlib.util.spec_from_file_location('updated_runner', workspace/'cold-lit-db'/'run_pipeline.py')
            updated = importlib.util.module_from_spec(spec); spec.loader.exec_module(updated)
            fingerprints = updated.sources(workspace)
            for path, item in queues:
                if item.get('status') == 'blocked':
                    item['pagination_block_recovered_from'] = item.get('error')
                    item.update(retry_at=0, error=None)
                item.update(sources=fingerprints, status='pending', patch_replay_reviewed=True)
                updated.atomic_json(path, item)
        except BaseException:
            for dst, old in originals:
                if old: shutil.copy2(old, dst)
                elif dst.exists(): dst.unlink()
            for path, _ in queues: shutil.copy2(backup/'queue'/path.name, path)
            raise
        summary.update(status='installed_not_online_verified', backup=str(backup))
        (backup/'INSTALL_RECEIPT.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        return summary


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace', type=Path, default=Path('~/workspace').expanduser())
    p.add_argument('--state', type=Path, default=Path(os.environ.get('OA_STATE_DIR', '~/.local/state/litdb-openalex')).expanduser())
    p.add_argument('--execute', action='store_true'); p.add_argument('--accept-pending-replay', action='store_true')
    a = p.parse_args()
    print(json.dumps(install(a.workspace, a.state, a.execute, a.accept_pending_replay), ensure_ascii=False))


if __name__ == '__main__': main()
