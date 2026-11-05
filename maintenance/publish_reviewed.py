"""Publish an explicitly reviewed, data-only main-library release.

Default: read-only verification. Credentials come only from the environment.
All publishers must share this lock; Supabase Storage has no atomic CAS here.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
import uuid

BASE = 'https://ywmjbivuibxsgjcmekob.supabase.co'
PUBLIC = BASE + '/storage/v1/object/public/litdb-data/'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def record_hash(record):
    return sha(json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode())


def identity(record):
    value = str(record.get('id', '')).removeprefix('https://openalex.org/')
    if not re.fullmatch(r'W\d+', value):
        raise ValueError('Invalid OpenAlex ID')
    return value


def manifest_check(m):
    if m.get('format') != 'sport-env-litdb-shards' or not re.fullmatch(r'[a-f0-9]{20}', m.get('version', '')):
        raise ValueError('Invalid manifest')
    if len(m.get('shards', [])) != 4:
        raise ValueError('Exactly four shards required')
    for i, part in enumerate(m['shards'], 1):
        if part['path'] != f"versions/{m['version']}/papers-{i}.json":
            raise ValueError('Unsafe shard path')
        if not re.fullmatch(r'[a-f0-9]{64}', part.get('sha256', '')):
            raise ValueError('Invalid shard hash')


def corpus(m, getter):
    manifest_check(m)
    result = {}
    for part in m['shards']:
        raw = getter(part['path'])
        if sha(raw) != part['sha256'] or len(raw) != part['bytes']:
            raise ValueError('Shard hash/size mismatch')
        rows = json.loads(raw)
        if not isinstance(rows, list) or len(rows) != part['records']:
            raise ValueError('Shard record count mismatch')
        for row in rows:
            key = identity(row)
            if key in result:
                raise ValueError('Duplicate record ID')
            result[key] = row
    if len(result) != m['total']:
        raise ValueError('Manifest total mismatch')
    return result


def verify(base, target, review, before, after):
    if review.get('format') != 'litdb-reviewed-release-v1':
        raise ValueError('Explicit reviewed release required')
    if review.get('base_manifest_sha256') != sha(base) or review.get('target_manifest_sha256') != sha(target):
        raise ValueError('Review does not match exact manifest bytes')
    if not review.get('reviewed_by') or not review.get('reviewed_at'):
        raise ValueError('Reviewer and review time required')
    windows = review.get('windows', [])
    if not windows or any(w.get('coverage_complete') is not True or w.get('unapplied_leaves') != 0 or w.get('pending_tasks') != 0 for w in windows):
        raise ValueError('Only completed and applied windows can be released')
    if not set(before).issubset(after):
        raise ValueError('Existing records cannot be deleted')
    changes = review.get('changes', [])
    approvals = {c['id']: c for c in changes}
    if len(approvals) != len(changes):
        raise ValueError('Duplicate review decision')
    changed = {key for key in after if key not in before or after[key] != before[key]}
    if changed != set(approvals):
        raise ValueError('Every changed record needs exact review; extra approvals rejected')
    held = set(review.get('hold_ids', []))
    if changed & held:
        raise ValueError('Held paper entered release')
    for key in changed:
        c, new, old = approvals[key], after[key], before.get(key)
        if c.get('decision') != 'pass' or not c.get('reason'):
            raise ValueError('Pass decision and reason required')
        if c.get('after_sha256') != record_hash(new) or c.get('before_sha256') != (record_hash(old) if old else None):
            raise ValueError('Reviewed paper hash mismatch')
        if old and old.get('abstract') and new.get('abstract') != old['abstract']:
            raise ValueError('Abstract edits require a separate audited correction')
        if not old and (not str(new.get('abstract') or '').strip() or not str(new.get('title') or '').strip()):
            raise ValueError('New paper needs title and abstract')
        if not old and (new.get('retracted') or new.get('is_retracted')):
            raise ValueError('Retracted addition rejected')
        if not old and (not isinstance(new.get('env'), list) or not new['env'] or any(x not in {'低温','高氧','高温','高温高湿','交叉适应','高原低氧','其他环境'} for x in new['env'])):
            raise ValueError('New paper needs reviewed environment')
    # New records must not duplicate an existing DOI or one another.
    def doi(p):
        return str(p.get('doi') or '').lower().removeprefix('https://doi.org/').removeprefix('http://doi.org/').strip()
    dois = {doi(p) for p in before.values() if doi(p)}
    for key in sorted(set(after) - set(before)):
        value = doi(after[key])
        if value and value in dois:
            raise ValueError('Duplicate DOI addition')
        if value:
            dois.add(value)
    return {'added': len(set(after) - set(before)), 'updated': len(changed & set(before)), 'total': len(after)}


class Storage:
    def get(self, path):
        req = urllib.request.Request(PUBLIC + path + '?verify=' + uuid.uuid4().hex, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()

    def put(self, path, raw):
        token = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        if not token:
            raise ValueError('SUPABASE_SERVICE_ROLE_KEY must be set securely in the runtime')
        req = urllib.request.Request(BASE + '/storage/v1/object/litdb-data/' + path, data=raw, method='POST', headers={
            'Authorization': 'Bearer ' + token, 'apikey': token, 'Content-Type': 'application/json',
            'x-upsert': 'true', 'Cache-Control': 'max-age=0'})
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read()


def publish(folder, storage, execute=False):
    folder = Path(folder)
    target = (folder / 'manifest.json').read_bytes()
    review = json.loads((folder / 'review.json').read_bytes())
    old = (folder / 'baseline-manifest.json').read_bytes()
    baseline, manifest = json.loads(old), json.loads(target)
    manifest_check(baseline)
    manifest_check(manifest)
    expected_version = sha(''.join(p['sha256'] for p in manifest['shards']).encode())[:20]
    if manifest['version'] != expected_version or (baseline['version'] == manifest['version'] and old != target):
        raise ValueError('Target must use its content-addressed immutable version')
    before = corpus(baseline, storage.get)
    raw_parts = {p['path']: (folder / Path(p['path']).name).read_bytes() for p in manifest['shards']}
    getter = raw_parts.__getitem__
    after = corpus(manifest, getter)
    counts = verify(old, target, review, before, after)
    live = storage.get('manifest.json')
    if live not in (old, target):
        raise ValueError('Live baseline changed; restage and review, do not overwrite')
    if execute and live != target:
        for part in manifest['shards']:
            raw = getter(part['path'])
            storage.put(part['path'], raw)
            if sha(storage.get(part['path'])) != part['sha256']:
                raise ValueError('Uploaded shard verification failed; manifest unchanged')
        if storage.get('manifest.json') != old:
            raise ValueError('Live baseline changed during upload; manifest unchanged')
        storage.put('manifest.json', target)
    if execute:
        if storage.get('manifest.json') != target:
            raise ValueError('Manifest readback mismatch; inspect live state before retry')
        corpus(manifest, storage.get)
    receipt = dict(counts, status='published_verified' if execute else 'verified_not_published',
                   version=manifest['version'], verified_at=dt.datetime.now(dt.timezone.utc).isoformat())
    # No private review decisions or reviewer identity in the public bucket.
    tmp = folder / 'publish-receipt.tmp'
    tmp.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(folder / 'publish-receipt.json')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--lock', type=Path, required=True, help='One shared lock path for ALL publishers')
    a = parser.parse_args()
    a.lock.parent.mkdir(parents=True, exist_ok=True)
    # Crash leaves a visible lock: inspect the process before removing it.
    with a.lock.open('x', encoding='utf-8') as f:
        f.write(str(os.getpid()))
    try:
        print(json.dumps(publish(a.release, Storage(), a.execute), ensure_ascii=False))
    finally:
        a.lock.unlink()


if __name__ == '__main__':
    main()
