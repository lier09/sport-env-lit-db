import hashlib
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import export_diagnostics as diagnostic


class DiagnosticsTests(unittest.TestCase):
    def test_export_is_readonly_and_omits_raw_payloads_and_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);workspace=root/'workspace';state=root/'state'
            (state/'queue').mkdir(parents=True)
            base=workspace/'cold-lit-db';(base/'data').mkdir(parents=True);(base/'logs').mkdir()
            (base/'data/merged.json').write_text('[{"id":"W1"}]')
            (base/'logs/qstat-2026-10-26.json').write_text(json.dumps([{'q':'critical power','total_hits':528000,'incomplete':True,'body':'SECRET_BODY'}]))
            queue={'job':'litdb','scope':'litdb-fixture','status':'blocked','error':'Repeated paper IDs',
                   'argv':['daily_update.py','--from','2026-10-22','--to','2026-10-24','--api-key','SECRET_ARG']}
            queue_path=state/'queue/litdb.json';queue_path.write_text(json.dumps(queue))
            database=state/'requests.sqlite3'
            with closing(sqlite3.connect(database)) as conn:
                conn.executescript('CREATE TABLE pages(scope TEXT,request TEXT,payload TEXT,saved REAL);CREATE TABLE events(at REAL,scope TEXT,kind TEXT,detail TEXT);')
                payload=json.dumps({'meta':{'count':528000,'next_cursor':'OPAQUE_CURSOR_SECRET'},
                                    'results':[{'id':'https://openalex.org/W1','abstract':'SECRET_ABSTRACT','pdf_url':'https://example.com?token=SECRET_LINK'}]})
                conn.executemany('INSERT INTO pages VALUES (?,?,?,?)',[('litdb-fixture',str(i),payload,1) for i in range(2)])
                conn.execute('INSERT INTO events VALUES (?,?,?,?)',(1,'litdb-fixture','http_error',json.dumps({'http':429,'body':'SECRET_EVENT'})))
                conn.commit()
            before=hashlib.sha256(database.read_bytes()).hexdigest();queue_before=queue_path.read_bytes()
            output=root/'diagnostics.zip'
            with patch.object(diagnostic,'MAX_PAGES',1): diagnostic.export(workspace,state,output)
            with zipfile.ZipFile(output) as z:
                raw=z.read('diagnostics.json').decode();data=json.loads(raw)
                for secret in ('SECRET_BODY','SECRET_ARG','SECRET_ABSTRACT','SECRET_LINK','SECRET_EVENT','OPAQUE_CURSOR_SECRET'):
                    self.assertNotIn(secret,raw)
                self.assertEqual(data['cache']['pages'][0]['ids'],['W1'])
                self.assertEqual(data['cache']['truncated']['pages']['omitted'],1)
                self.assertEqual(data['queues'][0]['window'],{'--from':'2026-10-22','--to':'2026-10-24'})
            self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(),before)
            self.assertEqual(queue_path.read_bytes(),queue_before)


if __name__=='__main__':unittest.main()
