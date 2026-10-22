import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from history_reconcile import History
from build_data_release import build

Q={'env':'高氧','mode':'hyperbaric','q':'"hyperbaric oxygen"','tag':'高压氧'}
def paper(n,abstract='Full abstract'):
    return {'id':f'https://openalex.org/W{n}','doi':f'10.1234/{n}','title':'Hyperbaric oxygen and exercise','abstract_inverted_index':{'Full':[0]},'abstract':abstract,'population':'human','env':['高氧']}
class Rules:
    PENDING_REVIEW=[]
    def clean_record(self,p,*args):return copy.deepcopy(p)
class Deferred(Exception):
    retry_at=123
class Tests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def history(self,queries=None,**kw):return History(self.root/'h.sqlite3',queries or [Q],'rules','2026-10-22',True,clock=lambda:100,**kw)
    def page(self,records,total=None,cursor=None):return {'meta':{'count':len(records) if total is None else total,'next_cursor':cursor},'results':records}
    def test_two_page_resume_does_not_repeat_completed_page(self):
        h=self.history();calls=[]
        def fetch(p,k):
            calls.append(p['cursor'])
            return self.page([paper(n) for n in range(1,51)],51,'NEXT') if p['cursor']=='*' else self.page([paper(51)],51)
        h.step(fetch,Rules(),'id',1);self.assertFalse(h.status()['all_queries_complete'])
        h=self.history();h.step(fetch,Rules(),'id',1)
        self.assertEqual(calls,['*','NEXT']);self.assertTrue(h.status()['all_queries_complete'])
        h.step(fetch,Rules(),'id',1);self.assertEqual(len(calls),2)
    def test_fair_queries_advance_behind_large_query(self):
        qs=[Q,{**Q,'q':'"hyperoxia"'}];h=self.history(qs);calls=[]
        def fetch(p,k):calls.append(k);return self.page([paper(n) for n in range(50)],100,'NEXT')
        h.step(fetch,Rules(),'id',2);self.assertEqual(len(set(calls)),2)
    def test_deferred_does_not_advance_or_lose_previous_page(self):
        h=self.history();h.step(lambda *_:self.page([paper(n) for n in range(50)],51,'NEXT'),Rules(),'id',1)
        def fail(*_):raise Deferred()
        with self.assertRaises(Deferred):h.step(fail,Rules(),'id',1)
        with h.db() as c:
            self.assertEqual(c.execute('select page,downloaded from queries').fetchone()[:],(2,50))
            self.assertEqual(c.execute('select count(*) from pages').fetchone()[0],1)
    def test_count_drift_does_not_certify_coverage(self):
        h=self.history();h.step(lambda *_:self.page([paper(n) for n in range(50)],51,'NEXT'),Rules(),'id',1)
        h.step(lambda *_:self.page([paper(51)],52),Rules(),'id',1)
        self.assertFalse(h.status()['all_queries_complete']);self.assertEqual(h.status()['query_status'],{'needs_review':1})
    def test_invalid_short_page_not_committed(self):
        h=self.history();h.step(lambda *_:self.page([paper(1)],80,'NEXT'),Rules(),'id',1)
        with h.db() as c:self.assertEqual(c.execute('select count(*) from pages').fetchone()[0],0)
    def test_missing_abstract_is_discovered_and_pending(self):
        h=self.history();h.step(lambda *_:self.page([paper(1,'')]),Rules(),'id',1)
        self.assertEqual(h.status()['decision_status'],{'pending':1});h.export(self.root/'c.json')
        data=json.loads((self.root/'c.json').read_text(encoding='utf-8'));self.assertIn('missing_abstract',data['papers'][0]['matches'][0]['reason'])
    def test_rejected_and_retracted_and_known_are_audited(self):
        h=self.history(known=[paper(1)]);p=paper(2);p['is_retracted']=True
        h.step(lambda *_:self.page([paper(1),p]),Rules(),'id',1)
        self.assertEqual(h.status()['decision_status'],{'known':1,'pending':1})
    def test_blocklist_applies_by_normalized_doi(self):
        h=self.history(blocklist={'dois':['https://doi.org/10.1234/1']});h.step(lambda *_:self.page([paper(1)]),Rules(),'id',1)
        self.assertEqual(h.status()['decision_status'],{'blocked':1})
    def test_config_change_requires_new_ledger(self):
        self.history()
        with self.assertRaises(ValueError):self.history([{**Q,'mode':'sport'}])
    def test_fixed_cutoff_is_preserved_on_resume(self):
        self.history();h=History(self.root/'h.sqlite3',[Q],'rules','2026-11-01',True)
        self.assertEqual(h.cutoff,'2026-10-22')
    def test_repeated_ids_across_pages_stop_coverage(self):
        h=self.history();h.step(lambda *_:self.page([paper(n) for n in range(50)],51,'NEXT'),Rules(),'id',1)
        h.step(lambda *_:self.page([paper(1)],51),Rules(),'id',1);self.assertEqual(h.status()['query_status'],{'needs_review':1})
    def test_rule_rejection_is_persisted(self):
        rules=Rules();rules.clean_record=lambda *args:None
        h=self.history();h.step(lambda *_:self.page([paper(1)]),rules,'id',1)
        self.assertEqual(h.status()['decision_status'],{'rejected':1})
    def test_basic_page_boundary_is_explicitly_incomplete(self):
        h=History(self.root/'h.sqlite3',[Q],'rules','2026-10-22',False)
        with h.db() as c:c.execute('UPDATE queries SET page=201,downloaded=10000,expected=10001')
        h.step(lambda *_:self.fail('must not request past basic paging boundary'),Rules(),'id',1)
        self.assertEqual(h.status()['query_status'],{'needs_review':1})
    def baseline(self):
        base=self.root/'base';base.mkdir();entries=[]
        for i in range(1,5):
            raw=json.dumps([paper(i)]).encode();(base/f'papers-{i}.json').write_bytes(raw)
            entries.append({'path':f'versions/old/papers-{i}.json','bytes':len(raw),'records':1,'sha256':hashlib.sha256(raw).hexdigest()})
        mf=base/'manifest.json';mf.write_text(json.dumps({'format':'sport-env-litdb-shards','version':'old','total':4,'shards':entries}))
        return mf,base
    def test_data_release_preserves_long_abstract_and_normalizes_population(self):
        mf,base=self.baseline();p=paper(99,'x'*9000);p['population']='人类';p['doi']='https://doi.org/10.1234/99'
        r=build(mf,base,[p],['W99'],self.root/'out');self.assertEqual(r['new_total'],5)
        records=sum([json.loads(x.read_text(encoding='utf-8')) for x in (self.root/'out').glob('papers-*.json')],[])
        result=next(x for x in records if x['id'].endswith('/W99'))
        self.assertEqual(result['population'],'human');self.assertEqual(len(result['abstract']),9000);self.assertEqual(result['ingest_kind'],'historical')
        for n in range(1,5):self.assertEqual(next(x for x in records if x['id'].endswith('/W'+str(n))),paper(n))
    def test_release_rejects_duplicate_doi_and_unapproved_addition(self):
        mf,base=self.baseline();p=paper(99);p['doi']='https://doi.org/10.1234/1'
        with self.assertRaises(ValueError):build(mf,base,[p],['W99'],self.root/'out')
        with self.assertRaises(ValueError):build(mf,base,[paper(99)],[],self.root/'out')
    def test_release_refuses_tampered_baseline_and_existing_output(self):
        mf,base=self.baseline();(base/'papers-1.json').write_text('[]')
        with self.assertRaises(ValueError):build(mf,base,[paper(99)],['W99'],self.root/'out')
    def test_release_only_includes_explicit_ids(self):
        mf,base=self.baseline();r=build(mf,base,[paper(99),paper(100)],['W99'],self.root/'out');self.assertEqual(r['approved_additions'],['W99']);self.assertEqual(r['new_total'],5)
    def test_release_refuses_retracted_or_unclassified_addition(self):
        mf,base=self.baseline();p=paper(99);p['is_retracted']=True
        with self.assertRaises(ValueError):build(mf,base,[p],['W99'],self.root/'out')
        p=paper(99);p['env']=['待分类']
        with self.assertRaises(ValueError):build(mf,base,[p],['W99'],self.root/'out')

if __name__=='__main__':unittest.main()
