"""Reproduce cached HTTP-200 duplicate pages, then recover without data loss."""
import hashlib
import json
import shutil
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'pipeline/cold-lit-db'))
import openalex_runtime as runtime


class Response:
    headers = {}
    def __init__(self, data): self.data = data
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self): return json.dumps(self.data).encode()


def page(ids, cursor=None, count=4):
    return {'meta': {'count': count, 'next_cursor': cursor},
            'results': [{'id': f'https://openalex.org/W{i}'} for i in ids]}


class RecoveryTests(unittest.TestCase):
    def test_old_poisoned_cache_is_quarantined_and_fresh_query_completes(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def opener(request, timeout):
                params = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
                calls.append(params)
                return Response(page([1,2], 'next') if params['cursor'] == ['*'] else page([3,4]))
            client = runtime.Client(root=tmp, scope='old-scope', opener=opener, interval=0)
            params = {'filter': 'title.search:fixture', 'per-page': 2}
            # Exactly v2 behavior: valid JSON responses already stored BEFORE
            # cross-page duplicate detection. No query-map table was populated.
            for cursor, payload in [('*', page([1,2], 'next')), ('next', page([1,2]))]:
                url = 'https://api.openalex.org/works?' + urllib.parse.urlencode({**params, 'cursor': cursor})
                request_id = hashlib.sha256(runtime.canonical(url).encode()).hexdigest()
                with client.db() as c:
                    c.execute('INSERT INTO pages VALUES (?,?,?,?)',
                              (client.scope, request_id, json.dumps(payload), 1))
            with client.db() as c:
                c.execute('INSERT INTO pages VALUES (?,?,?,?)', (client.scope, 'other-query', '{}', 1))
                client.put(c, 'remaining', 123); client.put(c, 'cooldown', 0)
            with patch.object(runtime.openalex_auth, 'has_key', return_value=True):
                with self.assertRaises(runtime.Deferred) as caught:
                    list(client.iter_pages(params))
                self.assertEqual(caught.exception.reason, 'pagination_inconsistent_retry')
                self.assertEqual(calls, [])  # First failure came entirely from old cached data.
                with client.db() as c:
                    self.assertEqual(c.execute('SELECT count(*) FROM invalidated_pages').fetchone()[0], 2)
                    self.assertEqual(c.execute('SELECT request FROM pages').fetchall(), [('other-query',)])
                    self.assertEqual(client.get(c, 'remaining'), 123)
                    self.assertEqual(client.get(c, 'cooldown'), 0)
                good = list(client.iter_pages(params))
                self.assertEqual([p['id'] for d in good for p in d['results']],
                                 [f'https://openalex.org/W{i}' for i in range(1,5)])
                self.assertEqual(len(calls), 2)
                with client.db() as c:
                    self.assertEqual(c.execute('SELECT count(*) FROM pagination_retries').fetchone()[0], 0)
                    self.assertEqual(c.execute('SELECT count(*) FROM invalidated_pages').fetchone()[0], 2)

    def test_retries_are_bounded_and_never_certify_duplicate_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = runtime.Client(root=tmp, scope='bounded', interval=0)
            def opener(request, timeout):
                cursor = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)['cursor'][0]
                return Response(page([1,2], 'next' if cursor == '*' else None))
            client.opener = opener
            with patch.object(runtime.openalex_auth, 'has_key', return_value=True):
                for attempt in (1,2):
                    with self.assertRaises(runtime.Deferred): list(client.iter_pages({'per-page':2}))
                with self.assertRaisesRegex(runtime.PipelineError, 'after 3 rejected query attempts'):
                    list(client.iter_pages({'per-page':2}))
                with client.db() as c:
                    self.assertEqual(c.execute('SELECT count(*) FROM pages').fetchone()[0], 0)
                    self.assertEqual(c.execute('SELECT count(*) FROM invalidated_pages').fetchone()[0], 6)
                    self.assertEqual(c.execute("SELECT count(*) FROM events WHERE kind='query_complete'").fetchone()[0], 0)

    def test_live_count_drift_retries_whole_query(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = runtime.Client(root=tmp, interval=0)
            with patch.object(runtime.openalex_auth, 'has_key', return_value=True), \
                 patch.object(client, 'fetch', side_effect=[page([1,2],'next'),page([3,4],count=5)]):
                with self.assertRaises(runtime.Deferred): list(client.iter_pages({'per-page':2}))


class MigrationTests(unittest.TestCase):
    def setup_workspace(self, tmp, reason):
        workspace = Path(tmp)/'workspace'; state = Path(tmp)/'state'
        shutil.copytree(ROOT/'pipeline', workspace, ignore=shutil.ignore_patterns('__pycache__','INSTALL_MANIFEST.json'))
        (state/'queue').mkdir(parents=True)
        item = {'job':'litdb','workspace':str(workspace),'scope':'keep-original-scope','status':'blocked',
                'error':reason,'retry_at':0,'argv':['daily_update.py','--from','2026-10-22','--to','2026-10-23']}
        (state/'queue/litdb.json').write_text(json.dumps(item),encoding='utf-8')
        return workspace,state,item

    def test_only_known_legacy_pagination_block_is_resumed_with_window_preserved(self):
        sys.path.insert(0,str(ROOT));import install_pipeline
        with tempfile.TemporaryDirectory() as tmp:
            workspace,state,original=self.setup_workspace(tmp,'Repeated paper IDs; pagination coverage not established')
            result=install_pipeline.install(workspace,state,execute=True,accept_pending_replay=True)
            self.assertEqual(result['status'],'installed_not_online_verified')
            item=json.loads((state/'queue/litdb.json').read_text(encoding='utf-8'))
            self.assertEqual(item['status'],'pending')
            self.assertEqual(item['scope'],original['scope']);self.assertEqual(item['argv'],original['argv'])
            self.assertEqual(item['pagination_block_recovered_from'],original['error'])

    def test_credential_or_code_blocks_remain_blocked(self):
        sys.path.insert(0,str(ROOT));import install_pipeline
        with tempfile.TemporaryDirectory() as tmp:
            workspace,state,_=self.setup_workspace(tmp,'OpenAlex HTTP 401')
            with self.assertRaisesRegex(ValueError,'Resolve blocked queue'):
                install_pipeline.install(workspace,state,execute=True,accept_pending_replay=True)
            self.assertEqual(json.loads((state/'queue/litdb.json').read_text())['status'],'blocked')


if __name__ == '__main__': unittest.main()
