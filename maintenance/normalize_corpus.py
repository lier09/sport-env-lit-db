"""Stage deterministic schema repairs; never overwrite input or infer eligibility."""
import argparse
import contextlib
import copy
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
from history_reconcile import ENVIRONMENTS


def normalize(records):
    result, changes = [], []
    for original in records:
        p = copy.deepcopy(original)
        if isinstance(p.get('env'), str) and p['env'] in ENVIRONMENTS | {'待分类'}:
            p['env'] = [p['env']]
        aliases = {'人类': 'human', '人类研究': 'human', '动物': 'animal'}
        if p.get('population') in aliases: p['population'] = aliases[p['population']]
        if 'population' not in p: p['population'] = 'unknown'
        if 'cited' not in p and type(p.get('cited_by_count')) is int and p['cited_by_count'] >= 0:
            p['cited'] = p['cited_by_count']
        if p.get('type') == 'article': p['type'] = '原创研究'
        if p.get('type') == 'review': p['type'] = '综述'
        if p.get('_history_backfill') and not p.get('ingest_kind'): p['ingest_kind'] = 'historical'
        delta = {k: {'before': original.get(k), 'after': p.get(k)} for k in p if original.get(k) != p.get(k)}
        if delta: changes.append({'id': p.get('id'), 'changes': delta})
        result.append(p)
    return result, changes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True); p.add_argument('--output', type=Path, required=True)
    p.add_argument('--apply', action='store_true', help='Under the installed writer lock, back up and atomically repair canonical JSON')
    a = p.parse_args()
    if a.output.exists() or a.output.resolve() == a.input.resolve(): raise ValueError('Output must be a new file')
    if a.apply:
        if a.input.name != 'merged.json' or a.input.parent.name != 'data':
            raise ValueError('Only actual uncompressed litdb canonical JSON can be applied')
        sys.path.insert(0, str(a.input.resolve().parent.parent))
        from run_pipeline import lock
        from data_transaction import recover
        from openalex_runtime import atomic_json
        state = Path(os.environ.get('OA_STATE_DIR', '~/.local/state/litdb-openalex')).expanduser()
        context = lock(state/'writer.lock')
    else: context = contextlib.nullcontext(True)
    with context as acquired:
        if not acquired: raise ValueError('Another writer is active')
        if a.apply: recover(state, a.input.resolve().parents[2])
        raw = a.input.read_bytes()
        records = json.loads(gzip.decompress(raw) if a.input.suffix == '.gz' else raw)
        normalized, changes = normalize(records)
        a.output.parent.mkdir(parents=True, exist_ok=True)
        a.output.write_text(json.dumps(normalized, ensure_ascii=False), encoding='utf-8')
        receipt = {'source_sha256': hashlib.sha256(raw).hexdigest(), 'before_count': len(records),
                   'after_count': len(normalized), 'changed_records': len(changes),
                   'status': 'staged_not_applied_or_uploaded', 'changes': changes}
        if a.apply and changes:
            backup = a.input.with_name('merged.schema-backup-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.json')
            shutil.copy2(a.input, backup)
            if hashlib.sha256(backup.read_bytes()).hexdigest() != receipt['source_sha256']:
                raise ValueError('Backup verification failed')
            atomic_json(a.input, normalized)
            receipt.update(status='applied_locally_not_uploaded', backup=str(backup))
        a.output.with_suffix('.repairs.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'count': len(normalized), 'changed_records': len(changes), 'deleted': 0}))


if __name__ == '__main__': main()
