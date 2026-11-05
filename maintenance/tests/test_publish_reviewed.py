import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publish_reviewed', Path(__file__).parents[1] / 'publish_reviewed.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def bundle(rows):
    parts = [json.dumps(rows).encode(), b'[]', b'[]', b'[]']
    version = p.sha(''.join(p.sha(x) for x in parts).encode())[:20]
    entries = [dict(path=f'versions/{version}/papers-{i+1}.json', sha256=p.sha(raw), bytes=len(raw), records=len(json.loads(raw))) for i, raw in enumerate(parts)]
    manifest = dict(format='sport-env-litdb-shards', version=version, total=len(rows), shards=entries)
    return json.dumps(manifest).encode(), dict(zip([e['path'] for e in entries], parts))


class Store:
    def __init__(self, base, parts):
        self.data = dict(parts, **{'manifest.json': base})
        self.writes = []
        self.corrupt = False

    def get(self, key):
        return self.data[key]

    def put(self, key, raw):
        self.writes.append(key)
        self.data[key] = b'bad' if self.corrupt else raw


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old = dict(id='W1', title='Old paper', abstract='Keep complete abstract', env=['低温'])
        self.new = dict(id='W2', title='Reviewed study', abstract='Complete abstract', env=['低温'])
        self.base, parts = bundle([self.old])
        self.target, newparts = bundle([self.old, self.new])
        self.store = Store(self.base, parts)
        for key, raw in newparts.items():
            (self.root / Path(key).name).write_bytes(raw)
        (self.root / 'manifest.json').write_bytes(self.target)
        (self.root / 'baseline-manifest.json').write_bytes(self.base)
        self.review = dict(format='litdb-reviewed-release-v1', reviewed_by='reviewer', reviewed_at='2026-11-05',
                           base_manifest_sha256=p.sha(self.base), target_manifest_sha256=p.sha(self.target),
                           windows=[dict(coverage_complete=True, unapplied_leaves=0, pending_tasks=0)], hold_ids=['W3'],
                           changes=[dict(id='W2', decision='pass', reason='Abstract checked against inclusion criteria', before_sha256=None, after_sha256=p.record_hash(self.new))])
        self.save()

    def save(self):
        (self.root / 'review.json').write_text(json.dumps(self.review), encoding='utf-8')

    def test_dry_run_never_uploads(self):
        self.assertEqual(p.publish(self.root, self.store)['status'], 'verified_not_published')
        self.assertEqual(self.store.writes, [])

    def test_manifest_last_verified_and_retry_idempotent(self):
        self.assertEqual(p.publish(self.root, self.store, True)['status'], 'published_verified')
        self.assertEqual(self.store.writes[-1], 'manifest.json')
        self.assertEqual(len(self.store.writes), 5)
        p.publish(self.root, self.store, True)
        self.assertEqual(len(self.store.writes), 5)

    def test_corrupt_uploaded_shard_leaves_old_manifest(self):
        self.store.corrupt = True
        with self.assertRaisesRegex(ValueError, 'Uploaded shard'):
            p.publish(self.root, self.store, True)
        self.assertEqual(self.store.data['manifest.json'], self.base)

    def test_changed_live_baseline_rejected(self):
        self.store.data['manifest.json'] = b'{"other":"version"}'
        with self.assertRaisesRegex(ValueError, 'baseline changed'):
            p.publish(self.root, self.store, True)
        self.assertEqual(self.store.writes, [])

    def test_incomplete_window_or_hold_or_missing_review_rejected(self):
        original = copy.deepcopy(self.review)
        for change in ['incomplete', 'held', 'missing']:
            self.review = copy.deepcopy(original)
            if change == 'incomplete':
                self.review['windows'][0]['pending_tasks'] = 1
            elif change == 'held':
                self.review['hold_ids'] = ['W2']
            else:
                self.review['changes'] = []
            self.save()
            with self.assertRaises(ValueError):
                p.publish(self.root, self.store, True)
        self.assertEqual(self.store.writes, [])

    def test_existing_abstract_changed_or_record_deleted_rejected(self):
        for rows in [[self.new], [dict(self.old, abstract='short'), self.new]]:
            target, parts = bundle(rows)
            review = dict(self.review, target_manifest_sha256=p.sha(target))
            before = {'W1': self.old}
            after = {r['id']: r for r in rows}
            if 'W1' in after:
                review['changes'] = self.review['changes'] + [dict(id='W1', decision='pass', reason='test', before_sha256=p.record_hash(self.old), after_sha256=p.record_hash(after['W1']))]
            with self.assertRaises(ValueError):
                p.verify(self.base, target, review, before, after)


if __name__ == '__main__':
    unittest.main()
