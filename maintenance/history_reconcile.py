"""Fair, durable historical discovery. Uses existing transport and rules.

No HTML builds, uploads, publication, successful-daily-date changes or corpus
writes. Each returned paper has a persisted decision, even when not eligible.
Candidates require review before applying them to the canonical library.
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.parse

ENVIRONMENTS = {'低温','高氧','高温','高温高湿','交叉适应','高原低氧','其他环境'}

def wid(value):
    match = re.fullmatch(r'(?:https://openalex.org/)?(W\d{1,20})', str(value or ''), re.I)
    if not match:
        raise ValueError('Missing/invalid OpenAlex ID')
    return match[1].upper()

def doi(value):
    return re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)', '', str(value or '').strip(), flags=re.I).lower()

def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

class History:
    def __init__(self, path, queries, rules_hash, cutoff, keyed, known=(), blocklist=None, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.keyed, self.known_ids, self.known_dois = keyed, set(), set()
        for p in known:
            try: self.known_ids.add(wid(p.get('id')))
            except ValueError: pass
            if doi(p.get('doi')): self.known_dois.add(doi(p['doi']))
        self.blocked_ids, self.blocked_dois = set(), set()
        for x in (blocklist or {}).get('ids', []): self.blocked_ids.add(wid(x))
        for x in (blocklist or {}).get('dois', []): self.blocked_dois.add(doi(x))
        config = {'queries': queries, 'rules_sha256': rules_hash, 'keyed': keyed,
                  'blocklist': blocklist or {}, 'format': 1}
        self.fingerprint = hashlib.sha256(packed(config).encode()).hexdigest()
        with self.db() as c:
            c.executescript('''
            CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, fingerprint TEXT, cutoff TEXT);
            CREATE TABLE IF NOT EXISTS queries (id TEXT PRIMARY KEY, spec TEXT, cursor TEXT,
              page INTEGER DEFAULT 1, downloaded INTEGER DEFAULT 0, expected INTEGER,
              status TEXT DEFAULT 'pending', last REAL DEFAULT 0, error TEXT);
            CREATE TABLE IF NOT EXISTS pages (query_id TEXT, page INTEGER, payload TEXT,
              saved REAL, PRIMARY KEY(query_id,page));
            CREATE TABLE IF NOT EXISTS decisions (query_id TEXT, paper_id TEXT,
              status TEXT, reason TEXT, raw TEXT, cleaned TEXT,
              PRIMARY KEY(query_id,paper_id));
            ''')
            old = c.execute('SELECT fingerprint,cutoff FROM config WHERE id=1').fetchone()
            if old and old[0] != self.fingerprint:
                raise ValueError('Rules/query/access mode changed: retain old ledger and start a new reviewed ledger')
            if old: self.cutoff = old[1]
            else:
                self.cutoff = dt.date.fromisoformat(cutoff).isoformat()
                c.execute('INSERT INTO config VALUES (1,?,?)', (self.fingerprint, self.cutoff))
            for q in queries:
                if q.get('env') not in ENVIRONMENTS or not q.get('q') or q.get('mode') not in ('sport','mechanism','hyperbaric'):
                    raise ValueError('Invalid historical query configuration')
                key = hashlib.sha256(packed(q).encode()).hexdigest()
                c.execute('INSERT OR IGNORE INTO queries(id,spec,cursor) VALUES (?,?,?)',
                          (key, packed(q), '*' if keyed else None))

    @contextlib.contextmanager
    def db(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        try:
            with c: yield c
        finally: c.close()

    def decide(self, raw, q, rules):
        key = wid(raw.get('id')); d = doi(raw.get('doi'))
        if key in self.blocked_ids or (d and d in self.blocked_dois):
            return key, 'blocked', 'dedup_blocklist', None
        if key in self.known_ids or (d and d in self.known_dois):
            return key, 'known', 'already_in_canonical_library', None
        if raw.get('is_retracted'):
            return key, 'pending', 'retracted_record', None
        prior = len(rules.PENDING_REVIEW)
        cleaned = rules.clean_record(raw, q['env'], q['tag'], q['mode'], q['q'])
        pending = rules.PENDING_REVIEW[prior:]
        del rules.PENDING_REVIEW[prior:]
        if not cleaned:
            return key, 'pending' if pending else 'rejected', (pending[0].get('reason') if pending else 'current_rules_reject'), None
        # Preserve discovery rather than silently admitting or discarding papers
        # whose abstract is not sufficient for the library's review policy.
        if not (cleaned.get('abstract') or '').strip():
            return key, 'pending', 'missing_abstract_requires_enrichment_review', cleaned
        return key, 'candidate', 'passed_current_rules_requires_review', cleaned

    def step(self, fetch_page, rules, select, limit=8):
        if not 1 <= limit <= 200: raise ValueError('Page budget must be 1..200')
        handled = set(); done = 0
        for _ in range(limit):
            with self.db() as c:
                rows = c.execute("SELECT * FROM queries WHERE status='pending' ORDER BY last,id").fetchall()
                row = next((r for r in rows if r['id'] not in handled), None)
                if row is None: break
                handled.add(row['id'])
                c.execute('UPDATE queries SET last=? WHERE id=?', (self.clock(), row['id']))
            q = json.loads(row['spec'])
            params = {'filter': f'to_publication_date:{self.cutoff},title_and_abstract.search:{q["q"]}',
                      'select': select, 'per-page': 50, 'sort': 'publication_date:desc'}
            params['cursor' if self.keyed else 'page'] = row['cursor'] if self.keyed else row['page']
            try:
                if not self.keyed and (row['page']-1)*50 >= 10000:
                    raise ValueError('Basic paging boundary: split this query or configure cursor access; not complete')
                data = fetch_page(params, row['id'])
                count = data.get('meta', {}).get('count'); records = data.get('results')
                if type(count) is not int or count < 0 or not isinstance(records, list) or len(records)>50:
                    raise ValueError('Invalid result count/page')
                keys = [wid(p.get('id')) for p in records]
                if len(set(keys)) != len(keys): raise ValueError('Duplicate IDs within page')
                with self.db() as c:
                    seen = {r[0] for r in c.execute('SELECT paper_id FROM decisions WHERE query_id=?', (row['id'],))}
                if seen.intersection(keys): raise ValueError('Page overlaps previous page; coverage not established')
                # A changing corpus is not an immutable snapshot. Keep raw pages,
                # but do not certify a full pass when counts drift.
                if row['expected'] is not None and count != row['expected']:
                    raise ValueError('Live count changed; retain evidence and restart this query in a new ledger')
                downloaded = row['downloaded']+len(records)
                if downloaded>count or (downloaded<count and len(records)!=50):
                    raise ValueError('Short/oversized page before declared total')
                complete = downloaded == count
                nxt = data.get('meta', {}).get('next_cursor')
                if self.keyed and not complete and (not nxt or nxt==row['cursor']):
                    raise ValueError('Missing/repeated cursor; query remains incomplete')
                decisions = [self.decide(p, q, rules) for p in records]
                with self.db() as c:
                    # Raw page, every decision, and next cursor commit together.
                    c.execute('INSERT INTO pages VALUES (?,?,?,?)', (row['id'],row['page'],packed(data),self.clock()))
                    for p,(key,status,reason,cleaned) in zip(records,decisions):
                        c.execute('INSERT INTO decisions VALUES (?,?,?,?,?,?)',
                                  (row['id'],key,status,reason,packed(p),packed(cleaned) if cleaned else None))
                    c.execute('UPDATE queries SET cursor=?,page=page+1,downloaded=?,expected=?,status=?,error=NULL WHERE id=?',
                              (nxt,downloaded,count,'complete' if complete else 'pending',row['id']))
                done += 1
            except Exception as e:
                # Record only safe local exception classes. HTTP exceptions can
                # contain signed URLs, so never store their string here.
                detail = str(e) if isinstance(e, ValueError) else type(e).__name__
                with self.db() as c:
                    c.execute('UPDATE queries SET error=?,status=? WHERE id=?',
                              (detail,'needs_review' if isinstance(e,ValueError) else 'pending',row['id']))
                if hasattr(e,'retry_at'): raise
        return done

    def status(self):
        with self.db() as c:
            groups = {r[0]:r[1] for r in c.execute('SELECT status,count(*) FROM queries GROUP BY status')}
            decisions = {r[0]:r[1] for r in c.execute('SELECT status,count(*) FROM decisions GROUP BY status')}
            papers = c.execute("SELECT count(DISTINCT paper_id) FROM decisions WHERE status='candidate'").fetchone()[0]
        return {'query_status':groups,'decision_status':decisions,'unique_candidate_papers':papers,
                'historical_cutoff':self.cutoff,'all_queries_complete':bool(groups) and set(groups)=={'complete'}}

    def export(self, output):
        # One paper can match multiple query groups; preserve all provenance.
        records = {}
        with self.db() as c:
            rows = c.execute("SELECT d.*,q.spec FROM decisions d JOIN queries q ON d.query_id=q.id WHERE d.status IN ('candidate','pending') ORDER BY paper_id,query_id").fetchall()
        for r in rows:
            p = records.setdefault(r['paper_id'], {'paper_id':r['paper_id'],'raw':json.loads(r['raw']),'matches':[]})
            p['matches'].append({'query':json.loads(r['spec']),'status':r['status'],'reason':r['reason'],
                                 'cleaned':json.loads(r['cleaned']) if r['cleaned'] else None})
        output = Path(output); tmp=output.with_suffix(output.suffix+'.tmp');output.parent.mkdir(parents=True,exist_ok=True)
        with tmp.open('w',encoding='utf-8') as f: json.dump({'format':'litdb-history-candidates','version':1,'coverage':self.status(),'papers':list(records.values())},f,ensure_ascii=False,indent=2)
        os.replace(tmp,output)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,required=True,help='Actual cold-lit-db directory')
    p.add_argument('--ledger',type=Path,required=True)
    p.add_argument('--pages',type=int,default=8)
    p.add_argument('--env',choices=sorted(ENVIRONMENTS))
    p.add_argument('--query',help='Exact configured query including phrase quotes')
    p.add_argument('--rolling',action='store_true',help='Start a new dated campaign only after the entire previous campaign completed')
    p.add_argument('--status',action='store_true')
    args=p.parse_args(); workspace=args.workspace.resolve();ledger=args.ledger.resolve()
    sys.path.insert(0,str(workspace))
    from run_pipeline import lock
    import openalex_runtime as runtime
    import openalex_auth
    # daily_update only has definitions/top-level constants, plus cwd change.
    rules=importlib.import_module('daily_update')
    queries=json.loads((workspace/'data/queries.json').read_text(encoding='utf-8'))
    if args.env:queries=[q for q in queries if q['env']==args.env]
    if args.query:queries=[q for q in queries if q['q']==args.query]
    if not queries:raise ValueError('No matching configured queries')
    if args.rolling:
        # Retain all old evidence. Never abandon an unfinished prior campaign
        # merely because a new calendar day has started.
        choices=sorted(ledger.parent.glob(ledger.stem+'.????-??-??'+ledger.suffix))
        if ledger.exists():choices.insert(0,ledger)
        if choices:
            active=choices[-1]
            with sqlite3.connect(active) as c:
                pending=c.execute("SELECT count(*) FROM queries WHERE status!='complete'").fetchone()[0]
                old_cutoff=c.execute('SELECT cutoff FROM config WHERE id=1').fetchone()[0]
            if pending or old_cutoff>=dt.date.today().isoformat():ledger=active
            else:ledger=ledger.with_name(ledger.stem+'.'+dt.date.today().isoformat()+ledger.suffix)
    known=json.loads((workspace/'data/merged.json').read_text(encoding='utf-8'))
    bl=workspace/'data/dedup_blocklist_20261014.json'
    rules_hash=hashlib.sha256((workspace/'daily_update.py').read_bytes()).hexdigest()
    state_root=Path(os.environ.get('OA_STATE_DIR','~/.local/state/litdb-openalex')).expanduser()
    history=History(ledger,queries,rules_hash,dt.date.today().isoformat(),openalex_auth.has_key(),known,
                    json.loads(bl.read_text(encoding='utf-8')) if bl.exists() else {})
    if args.status:print(packed(history.status()));return 0
    with lock(state_root/'writer.lock') as acquired:
        if not acquired:return 75
        clients={}
        def fetch_page(params,key):
            # Existing state root retains cooldown/quota across ALL jobs.
            scope='history-'+hashlib.sha256((str(ledger)+history.fingerprint+key).encode()).hexdigest()
            if key not in clients:clients[key]=runtime.Client(root=state_root,scope=scope)
            client=clients[key]
            return client.fetch('https://api.openalex.org/works?'+urllib.parse.urlencode(params))
        old_bg=os.environ.get('OA_BACKGROUND');old_deadline=os.environ.get('OA_DEADLINE')
        os.environ['OA_BACKGROUND']='1';os.environ['OA_DEADLINE']=str(time.time()+240)
        try:
            history.step(fetch_page,rules,rules.SELECT,args.pages)
        except runtime.Deferred as e:
            history.export(ledger.with_suffix('.candidates.json'));print(packed({'status':'pending','reason':e.reason,'retry_at':e.retry_at}));return 75
        finally:
            for name,old in [('OA_BACKGROUND',old_bg),('OA_DEADLINE',old_deadline)]:
                if old is None:os.environ.pop(name,None)
                else:os.environ[name]=old
        history.export(ledger.with_suffix('.candidates.json'));print(packed(history.status()))
        return 0 if history.status()['all_queries_complete'] else 75

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:
        # Do not emit request URLs, credentials or arbitrary server responses.
        print('Historical reconciliation blocked: '+type(e).__name__,file=sys.stderr);sys.exit(78)
