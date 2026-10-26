"""Export bounded, read-only ingestion evidence. No API calls or raw payloads.

Does not import collectors, access API-key files, mutate SQLite, or restart jobs.
"""
import argparse
from contextlib import closing
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import zipfile


MAX_PAGES = 3000
MAX_EVENTS = 500


def safe(value):
    if isinstance(value, dict): return {k: safe(v) for k,v in value.items() if k.lower() not in ('api_key','authorization','apikey','token','password')}
    if isinstance(value, list): return [safe(v) for v in value]
    if isinstance(value, str):
        value=re.sub(r'(?i)((?:api[_-]?key|access_token|token|password)\s*[=:]\s*)[^\s&,;]+',r'\1[REDACTED]',value)
        value=re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[REDACTED_JWT]',value)
    return value


def page_summary(payload):
    digest=hashlib.sha256(payload.encode()).hexdigest()
    try:data=json.loads(payload)
    except (ValueError,TypeError):return {'invalid_payload':True,'payload_sha256':digest}
    if not isinstance(data,dict):return {'invalid_payload':True,'payload_sha256':digest}
    meta=data.get('meta') if isinstance(data.get('meta'),dict) else {}
    rows=data.get('results') if isinstance(data.get('results'),list) else []
    ids=[]
    for row in rows:
        value=str(row.get('id') or '').rstrip('/').split('/')[-1].upper() if isinstance(row,dict) else ''
        ids.append(value if re.fullmatch(r'W\d+',value) else None)
    cursor=meta.get('next_cursor')
    return {'count':meta.get('count') if type(meta.get('count')) is int else None,'results':len(rows),'ids':ids,
            'next_cursor_sha256':hashlib.sha256(str(cursor).encode()).hexdigest() if cursor else None,
            'payload_sha256':digest}


def collect(workspace,state):
    workspace,state=Path(workspace).resolve(),Path(state).resolve()
    result={'checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'scope':'current local files and readonly SQLite snapshot; no API probes',
            'scripts':{},'corpora':{},'queues':[],'qstat':{},'queries':{}}
    scopes=[]
    for folder,name in [('cold-lit-db','merged.json'),('consensus-db','consensus.json'),('perfmod-db','perfmod.json')]:
        base=workspace/folder
        result['scripts'][folder]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in base.glob('*.py')}
        path=base/'data'/name
        if path.exists():
            raw=path.read_bytes();result['corpora'][folder]={'sha256':hashlib.sha256(raw).hexdigest(),'records':len(json.loads(raw))}
        plan=base/'data/queries.json'
        if plan.exists():result['queries'][folder]=safe(json.loads(plan.read_text(encoding='utf-8')))
        for p in sorted((base/'logs').glob('qstat-*.json'))[-3:]:
            data=json.loads(p.read_text(encoding='utf-8'))
            fields=('q','env','tag','type','total_hits','downloaded','pages','new_kept','incomplete','status')
            result['qstat'][folder+'/'+p.name]=[safe({k:row[k] for k in fields if k in row}) for row in data]
    for p in sorted((state/'queue').glob('*.json')):
        data=json.loads(p.read_text(encoding='utf-8'))
        row={k:data.get(k) for k in ('job','scope','day','status','retry_at','exit_code','error','sources','pagination_block_recovered_from')}
        # Only retain date/full flags, never the complete arbitrary command.
        argv=data.get('argv') or [];row['window']={}
        for flag in ('--from','--to'):
            if flag in argv and argv.index(flag)+1<len(argv):
                value=argv[argv.index(flag)+1]
                if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):row['window'][flag]=value
        row['full']='--full' in argv
        result['queues'].append(safe(row))
        if isinstance(data.get('scope'),str):scopes.append(data['scope'])
    database=state/'requests.sqlite3'
    result['cache']={'pages':[],'quarantined':[],'events':[],'truncated':{}}
    if database.exists() and scopes:
        with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=10)) as conn:
            conn.execute('PRAGMA query_only=ON');conn.execute('BEGIN')
            tables={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            result['cache']['tables']=sorted(tables)
            placeholders=','.join('?' for _ in scopes)
            for table,output in [('pages','pages'),('invalidated_pages','quarantined')]:
                if table not in tables:continue
                total=conn.execute(f'SELECT count(*) FROM {table} WHERE scope IN ({placeholders})',scopes).fetchone()[0]
                result['cache']['truncated'][output]={'total':total,'exported':min(total,MAX_PAGES),'omitted':max(0,total-MAX_PAGES)}
                fields='scope,request,payload' if table=='pages' else 'scope,request,payload,query_id,attempt,reason'
                for r in conn.execute(f'SELECT {fields} FROM {table} WHERE scope IN ({placeholders}) LIMIT ?',[*scopes,MAX_PAGES]):
                    row={'scope':r[0],'request':r[1],**page_summary(r[2])}
                    if table!='pages':row.update(query_id=r[3],attempt=r[4],reason=r[5])
                    result['cache'][output].append(safe(row))
            if 'query_requests' in tables:
                result['cache']['query_requests']=[{'scope':r[0],'query_id':r[1],'request':r[2]} for r in conn.execute(
                    f'SELECT scope,query_id,request FROM query_requests WHERE scope IN ({placeholders}) LIMIT ?',[*scopes,MAX_PAGES])]
            if 'events' in tables:
                for at,scope,kind,detail in conn.execute(f'SELECT at,scope,kind,detail FROM events WHERE scope IN ({placeholders}) ORDER BY rowid DESC LIMIT ?',[*scopes,MAX_EVENTS]):
                    try:data=json.loads(detail)
                    except (ValueError,TypeError):data={}
                    allowed={k:data[k] for k in ('request','query','http','bytes','type','attempt','reason','retry','downloaded','total') if k in data}
                    result['cache']['events'].append(safe({'at':at,'scope':scope,'kind':kind,'detail':allowed}))
    return result


def export(workspace,state,output):
    output=Path(output)
    if output.exists():raise ValueError('Output ZIP must be new')
    data=collect(workspace,state)
    raw=json.dumps(data,ensure_ascii=False,indent=2).encode()
    if len(raw)>20*1024*1024:raise ValueError('Evidence exceeds 20MiB; reduce MAX_PAGES and disclose truncation')
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('diagnostics.json',raw)
        z.writestr('SHA256SUMS.txt',hashlib.sha256(raw).hexdigest()+'  diagnostics.json\n')
    return {'output':str(output),'bytes':output.stat().st_size,'api_calls':0,'state_modified':False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,default=Path('~/workspace').expanduser())
    p.add_argument('--state',type=Path,default=Path(os.environ.get('OA_STATE_DIR','~/.local/state/litdb-openalex')).expanduser())
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();print(json.dumps(export(args.workspace,args.state,args.output),ensure_ascii=False))


if __name__=='__main__':main()
