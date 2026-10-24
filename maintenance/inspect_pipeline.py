"""Read-only local receipts; never prints payloads, credentials or server bodies."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3


def inspect(workspace, state):
    workspace, state = Path(workspace).resolve(), Path(state).resolve()
    result = {'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'state_directory': str(state), 'queues': [], 'script_sha256': {}, 'corpora': {}}
    for folder, name in [('cold-lit-db','merged.json'),('consensus-db','consensus.json'),('perfmod-db','perfmod.json')]:
        path=workspace/folder/'data'/name
        if path.exists():
            raw=path.read_bytes()
            result['corpora'][folder]={'sha256':hashlib.sha256(raw).hexdigest(),'records':len(json.loads(raw))}
    for name in ('run_pipeline.py', 'openalex_runtime.py', 'safe_entry.py'):
        p = workspace/'cold-lit-db'/name
        result['script_sha256'][name] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    for p in sorted((state/'queue').glob('*.json')):
        item = json.loads(p.read_text(encoding='utf-8'))
        row = {key: item.get(key) for key in ('job','scope','status','retry_at','exit_code')}
        # Avoid arbitrary errors/commands which may contain credential strings.
        error = str(item.get('error') or '')
        row['pagination_error'] = any(t in error.lower() for t in ('pagination','repeated paper','short page','live result count'))
        row['error_sha256'] = hashlib.sha256(error.encode()).hexdigest() if error else None
        result['queues'].append(row)
    db = state/'requests.sqlite3'
    if db.exists():
        with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True,timeout=10) as c:
            c.execute('PRAGMA query_only=ON')
            tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            result['cache_by_scope'] = [dict(scope=r[0],pages=r[1]) for r in c.execute('SELECT scope,count(*) FROM pages GROUP BY scope')]
            if 'invalidated_pages' in tables:
                result['quarantined_queries'] = [dict(scope=r[0],query=r[1],attempt=r[2],pages=r[3])
                    for r in c.execute('SELECT scope,query_id,attempt,count(*) FROM invalidated_pages GROUP BY scope,query_id,attempt')]
            result['recent_event_counts'] = [dict(kind=r[0],count=r[1]) for r in c.execute(
                'SELECT kind,count(*) FROM (SELECT kind FROM events ORDER BY rowid DESC LIMIT 1000) GROUP BY kind')]
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace',type=Path,default=Path('~/workspace').expanduser())
    p.add_argument('--state',type=Path,default=Path(os.environ.get('OA_STATE_DIR','~/.local/state/litdb-openalex')).expanduser())
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();result=inspect(a.workspace,a.state)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__': main()
