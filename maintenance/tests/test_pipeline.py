"""Offline fault injection against the actual replacement daily/runtime code."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

MAINT = Path(__file__).resolve().parents[1]
RUNTIME = MAINT/'pipeline'/'cold-lit-db'
sys.path.insert(0, str(RUNTIME))
import ingest_guard as guard
import openalex_runtime as runtime
from data_transaction import Transaction, recover


def load_daily(base):
    cwd = os.getcwd()
    spec = importlib.util.spec_from_file_location('audited_daily', RUNTIME/'daily_update.py')
    mod = importlib.util.module_from_spec(spec)
    try: spec.loader.exec_module(mod)
    finally: os.chdir(cwd)
    mod.BASE = str(base)
    return mod


def paper(n=1):
    return {'id': f'https://openalex.org/W{n}', 'doi': f'https://doi.org/10.1234/test{n}',
            'title': 'Exercise training during heat exposure', 'publication_year': 2026,
            'type': 'article', 'abstract_inverted_index': {'Exercise': [0], 'training': [1]},
            'topics': [{'display_name': 'Exercise physiology', 'field': {'display_name': 'Medicine'}}],
            'primary_location': {'source': {'display_name': 'Journal of Sports Sciences'}}}


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.base = Path(self.temp.name)
        self.du = load_daily(self.base)
    def tearDown(self): self.temp.cleanup()
    def clean(self, raw, mode='sport'):
        return self.du.clean_record(raw, '高温', '热暴露', mode, 'heat exposure')
    def pending(self):
        return json.loads(next((self.base/'data').glob('pending_review_*.json')).read_text(encoding='utf-8'))
    def test_missing_abstract_is_pending_even_in_sports_journal(self):
        raw = paper(); raw.pop('abstract_inverted_index')
        self.assertIsNone(self.clean(raw)); self.assertEqual(self.pending()[0]['raw'], raw)
        self.clean(raw); self.assertEqual(len(self.pending()), 1)
        self.assertEqual(self.pending()[0]['env'], '高温')
    def test_missing_topics_and_retraction_cannot_be_auto_admitted(self):
        raw = paper(); raw['topics'] = []
        self.assertIsNone(self.clean(raw))
        raw = paper(2); raw['is_retracted'] = True
        self.assertIsNone(self.clean(raw)); self.assertEqual(len(self.pending()), 2)
    def test_performance_and_recovery_alone_do_not_establish_exercise(self):
        for mode, title in [('sport', 'Indoor climate performance in intensive care units'),
                            ('hyperbaric', 'Hyperbaric oxygen improves wound recovery')]:
            raw = paper(); raw['title'] = title
            raw['abstract_inverted_index'] = {'Clinical': [0], 'performance': [1], 'recovery': [2]}
            raw['primary_location']['source']['display_name'] = 'Clinical Medicine'
            raw['topics'] = [{'display_name': 'Medicine', 'field': {'display_name': 'Medicine'}}]
            self.assertIsNone(self.clean(raw, mode))
        self.assertEqual({p['reason'] for p in self.pending()}, {'exercise_relationship_requires_review'})
    def test_clear_exercise_kept_weak_mechanism_retained_for_review(self):
        self.assertIsNotNone(self.clean(paper()))
        raw = paper(2); raw['title'] = 'Oxygen toxicity in liver mitochondria'
        raw['abstract_inverted_index'] = {'Mitochondria': [0], 'oxygen': [1]}
        self.assertIsNone(self.clean(raw, 'mechanism'))
        self.assertEqual(self.pending()[0]['reason'], 'mechanism_exercise_relationship_requires_review')
    def test_discovery_capture_does_not_write_canonical_pending_files(self):
        raw = paper(); raw['topics'] = []
        with guard.capture_reviews() as records: self.assertIsNone(self.clean(raw))
        self.assertEqual(len(records), 1); self.assertFalse((self.base/'data').exists())
    def test_identity_uses_id_and_normalized_doi_not_shared_title(self):
        a = paper(); b = paper(2); b['title'] = a['title']
        self.assertFalse(guard.identity(a) & guard.identity(b))
        b['id'] = 'W1'; self.assertTrue(guard.identity(a) & guard.identity(b))
        b['id'] = 'W3'; b['doi'] = 'DOI: 10.1234/TEST1'
        self.assertTrue(guard.identity(a) & guard.identity(b))
    def test_missing_or_invalid_blocklist_is_not_silently_ignored(self):
        with self.assertRaises(runtime.PipelineError): guard.blocked(self.base/'missing')
        p = self.base/'block.json'; p.write_text('{}', encoding='utf-8')
        with self.assertRaises(runtime.PipelineError): guard.blocked(p)
    def test_direct_main_writer_refused(self):
        with patch.dict(os.environ, {'OA_MANAGED': '0'}):
            with self.assertRaises(runtime.PipelineError): self.du.main()


class DailyReplayTests(unittest.TestCase):
    def test_citation_only_update_is_saved_without_new_papers(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); (base/'data').mkdir()
            old = {'id': 'W1', 'doi': '10.1234/one', 'title': 'Existing', 'cited': 1, 'year': 2020}
            for name, value in [('merged.json', [old]), ('queries.json', []), ('dedup_blocklist_20261014.json', {'ids': []})]:
                (base/'data'/name).write_text(json.dumps(value), encoding='utf-8')
            du = load_daily(base)
            def refresh(rows): rows[0]['cited'] = 2; return 1, 0
            def pages(params): yield {'meta': {'count': 0}, 'results': []}
            with patch.dict(os.environ, {'OA_MANAGED': '1'}), patch.object(sys, 'argv', ['daily_update.py']), \
                 patch.object(du.oa_runtime, 'iter_pages', pages), patch.object(du, 'refresh_cited', refresh), \
                 patch.object(du.subprocess, 'run'):
                du.main()
            saved = json.loads((base/'data/merged.json').read_text(encoding='utf-8'))
            self.assertEqual(saved[0]['cited'], 2)
    def test_cross_environment_tags_merge_for_new_record_and_no_legacy_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); (base/'data').mkdir()
            (base/'data/merged.json').write_text('[]', encoding='utf-8')
            (base/'data/dedup_blocklist_20261014.json').write_text('{"ids":[]}', encoding='utf-8')
            queries = [{'q': 'fixture one', 'env': '高温', 'tag': '热', 'mode': 'sport'},
                       {'q': 'fixture two', 'env': '高原低氧', 'tag': '低氧', 'mode': 'sport'}]
            (base/'data/queries.json').write_text(json.dumps(queries), encoding='utf-8')
            du = load_daily(base)
            def pages(params):
                recs = [paper()] if 'fixture ' in params['filter'] else []
                yield {'meta': {'count': len(recs)}, 'results': recs}
            with patch.dict(os.environ, {'OA_MANAGED': '1'}), patch.object(sys, 'argv', ['daily_update.py', '--full']), \
                 patch.object(du.oa_runtime, 'iter_pages', pages), patch.object(du, 'refresh_cited', return_value=(0, 0)), \
                 patch.object(du.subprocess, 'run') as command:
                du.main()
            saved = json.loads((base/'data/merged.json').read_text(encoding='utf-8'))
            self.assertEqual(len(saved), 1)
            self.assertEqual(set(saved[0]['env']), {'高温', '高原低氧'})
            self.assertEqual(set(saved[0]['tags']), {'热', '低氧'})
            self.assertTrue(all('build.py' not in str(c) for c in command.call_args_list))
    def test_all_daily_entries_preserved_above_sixty(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); (base/'data').mkdir()
            for name, value in [('merged.json', []), ('dedup_blocklist_20261014.json', {'ids': []}),
                                ('queries.json', [{'q': 'fixture', 'env': '高温', 'tag': '热', 'mode': 'sport'}])]:
                (base/'data'/name).write_text(json.dumps(value), encoding='utf-8')
            du = load_daily(base)
            def pages(params):
                rows = [paper(i) for i in range(1, 62)] if params['filter'].endswith('search:fixture') else []
                yield {'meta': {'count': len(rows)}, 'results': rows}
            with patch.dict(os.environ, {'OA_MANAGED': '1'}), patch.object(sys, 'argv', ['daily_update.py']), \
                 patch.object(du.oa_runtime, 'iter_pages', pages), patch.object(du, 'refresh_cited', return_value=(0, 0)), \
                 patch.object(du.subprocess, 'run'):
                du.main()
            daily = json.loads((base/'data/daily_new.json').read_text(encoding='utf-8'))
            self.assertEqual(len(next(iter(daily.values()))), 61)


class TransactionTests(unittest.TestCase):
    def test_interruption_restores_all_data_and_removes_new_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root/'state'; state.mkdir()
            data = root/'workspace/cold-lit-db/data'; data.mkdir(parents=True)
            (data/'merged.json').write_text('[{"id":"W1"}]', encoding='utf-8')
            tx = Transaction(state, root/'workspace', 'litdb'); tx.begin()
            (data/'merged.json').write_text('[]', encoding='utf-8')
            (data/'update_state.json').write_text('{"last_run":"2099-01-01"}', encoding='utf-8')
            (data/'pending_review_today.json').write_text('[1]', encoding='utf-8')
            self.assertTrue(recover(state, root/'workspace'))
            self.assertEqual(json.loads((data/'merged.json').read_text()), [{'id': 'W1'}])
            self.assertFalse((data/'update_state.json').exists())
            self.assertTrue((data/'pending_review_today.json').exists())
            self.assertFalse(recover(state, root/'workspace'))
    def test_committed_data_not_rolled_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root/'state'; state.mkdir()
            tx = Transaction(state, root, 'perfmod'); tx.begin()
            data = root/'perfmod-db/data'; data.mkdir(parents=True)
            (data/'perfmod.json').write_text('[1]')
            tx.commit(); self.assertFalse(recover(state, root))
            self.assertEqual((data/'perfmod.json').read_text(), '[1]')


class PagingTests(unittest.TestCase):
    def check(self, pages):
        with tempfile.TemporaryDirectory() as tmp:
            client = runtime.Client(root=tmp)
            with patch.object(runtime.openalex_auth, 'has_key', return_value=True), patch.object(client, 'fetch', side_effect=pages):
                return list(client.iter_pages({'per-page': 2}))
    def test_duplicate_pages_rejected_even_when_total_count_matches(self):
        pages = [{'meta': {'count': 4, 'next_cursor': 'next'}, 'results': [paper(1), paper(2)]},
                 {'meta': {'count': 4}, 'results': [paper(1), paper(2)]}]
        with self.assertRaises(runtime.PipelineError): self.check(pages)
    def test_valid_pages_and_zero_results(self):
        self.assertEqual(len(self.check([{'meta': {'count': 0}, 'results': []}])), 1)
        self.assertEqual(len(self.check([{'meta': {'count': 1}, 'results': [paper()]}])), 1)
    def test_oversized_and_missing_id_pages_rejected(self):
        for rows in ([paper(1), paper(2), paper(3)], [{'title': 'no ID'}]):
            with self.assertRaises(runtime.PipelineError): self.check([{'meta': {'count': len(rows)}, 'results': rows}])


class AuxiliaryDailyTests(unittest.TestCase):
    def test_both_auxiliary_jobs_use_conservative_gate_and_identity_dedup(self):
        # Separate processes exercise the real import chain without cross-library
        # module-name collisions or access to the operator's real home directory.
        code = '''
import importlib.util,json,os,sys
from pathlib import Path
workspace=Path(sys.argv[1]); job=sys.argv[2]; folder=workspace/(job+'-db')
spec=importlib.util.spec_from_file_location('aux_daily',folder/'daily_update.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def raw(n):
    return {'id':'https://openalex.org/W'+str(n),'doi':'https://doi.org/10.1234/'+str(n),
      'title': 'Consensus statement on exercise training' if job=='consensus' else 'Critical power model during exercise training',
      'type':'article','publication_year':2026,
      'abstract_inverted_index':{'Exercise':[0],'critical':[1],'power':[2],'model':[3]},
      'topics':[{'display_name':'Exercise physiology'}],
      'primary_location':{'source':{'display_name':'Journal of Sports Sciences'}}}
rows=[raw(1),raw(2),raw(1),raw(3),raw(4)]
rows[2]['doi']='DOI: 10.1234/1';rows[3]['abstract_inverted_index']=None;rows[4]['is_retracted']=True
def pages(params):yield {'meta':{'count':len(rows)},'results':rows}
mod.du.oa_runtime.iter_pages=pages
mod.main()
saved=json.loads((folder/'data'/(job+'.json')).read_text(encoding='utf-8'))
assert len(saved)==2, saved
pending=json.loads(next((folder/'data').glob('pending_review_*.json')).read_text(encoding='utf-8'))
assert {p['reason'] for p in pending}=={'missing_abstract_requires_enrichment_review','retracted_requires_review'}
assert not (folder/'build-called').exists()
'''
        for job in ('consensus', 'perfmod'):
            with self.subTest(job=job), tempfile.TemporaryDirectory() as tmp:
                workspace = Path(tmp)/'workspace'
                shutil.copytree(MAINT/'pipeline', workspace, ignore=shutil.ignore_patterns('__pycache__', 'INSTALL_MANIFEST.json'))
                data = workspace/'cold-lit-db/data'; data.mkdir()
                (data/'dedup_blocklist_20261014.json').write_text('{"ids":[]}', encoding='utf-8')
                folder = workspace/(job+'-db'); (folder/'data').mkdir()
                (folder/'data'/f'{job}.json').write_text('[]', encoding='utf-8')
                (folder/'data/queries.json').write_text('[{"q":"critical power","tag":"临界功率"}]', encoding='utf-8')
                (folder/'build.py').write_text("raise RuntimeError('Old build must never run')", encoding='utf-8')
                env = dict(os.environ, LITDB_WORKSPACE=str(workspace), OA_MANAGED='1', PYTHONIOENCODING='utf-8')
                result = subprocess.run([sys.executable, '-c', code, str(workspace), job], env=env,
                                        capture_output=True, text=True, encoding='utf-8', timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout+result.stderr)


class InstallerTests(unittest.TestCase):
    def test_checked_install_preserves_pending_scope_and_frozen_arguments(self):
        sys.path.insert(0, str(MAINT))
        import install_pipeline
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); workspace = root/'workspace'; state = root/'state'
            shutil.copytree(MAINT/'pipeline', workspace, ignore=shutil.ignore_patterns('__pycache__', 'INSTALL_MANIFEST.json'))
            (state/'queue').mkdir(parents=True)
            item = {'job': 'litdb', 'workspace': str(workspace), 'scope': 'unchanged-scope', 'status': 'pending',
                    'retry_at': 9999999999, 'argv': ['daily_update.py', '--from', '2026-10-15', '--to', '2026-10-22']}
            path = state/'queue/litdb.json'; path.write_text(json.dumps(item), encoding='utf-8')
            with self.assertRaises(ValueError): install_pipeline.install(workspace, state)
            result = install_pipeline.install(workspace, state, execute=True, accept_pending_replay=True)
            self.assertEqual(result['status'], 'installed_not_online_verified')
            saved = json.loads(path.read_text(encoding='utf-8'))
            for key in ('scope', 'argv', 'retry_at'): self.assertEqual(saved[key], item[key])
            self.assertTrue(saved['sources']); self.assertTrue(Path(result['backup']).exists())
    def test_newer_remote_code_is_not_overwritten(self):
        sys.path.insert(0, str(MAINT))
        import install_pipeline
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); workspace = root/'workspace'
            shutil.copytree(MAINT/'pipeline', workspace, ignore=shutil.ignore_patterns('__pycache__', 'INSTALL_MANIFEST.json'))
            path = workspace/'consensus-db/daily_update.py'
            path.write_text('# Newer work must be reviewed', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Installed file changed'):
                install_pipeline.install(workspace, root/'state', execute=True)
            self.assertEqual(path.read_text(), '# Newer work must be reviewed')


class SchemaTests(unittest.TestCase):
    def test_schema_repairs_preserve_identity_content_and_record_count(self):
        sys.path.insert(0, str(MAINT))
        from normalize_corpus import normalize
        source = [{'id': 'W1', 'env': '高原低氧', 'title': 'Keep', 'abstract': 'Full abstract',
                   'cited_by_count': 12, 'type': 'article', '_history_backfill': True}]
        result, changes = normalize(source)
        self.assertEqual(source[0]['env'], '高原低氧')
        self.assertEqual(result[0]['env'], ['高原低氧'])
        self.assertEqual(result[0]['population'], 'unknown')
        self.assertEqual(result[0]['cited'], 12)
        for key in ('id', 'title', 'abstract'): self.assertEqual(result[0][key], source[0][key])
        self.assertEqual(len(result), 1); self.assertEqual(len(changes), 1)
    def test_public_addition_strips_internal_operator_notes(self):
        sys.path.insert(0, str(MAINT))
        from build_data_release import public_paper
        result = public_paper({'id': 'W1', 'doi': '10.1234/a', '_private_note': 'not public',
                               '_authorships': [{'institutions': [{'display_name': 'University'}]}]})
        self.assertEqual(result['affiliations'], ['University'])
        self.assertFalse(any(key.startswith('_') for key in result))


if __name__ == '__main__': unittest.main()
