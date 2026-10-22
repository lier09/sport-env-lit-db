"""Stage a data-only release from a verified public baseline and reviewed additions.

No old site template, abstract truncation, corpus deletion, network upload or
public manifest mutation. --approve-id must explicitly name every addition.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from history_reconcile import doi, wid, ENVIRONMENTS

def read(path):
    path=Path(path)
    if path.suffix=='.gz':
        with gzip.open(path,'rt',encoding='utf-8') as f:return json.load(f)
    return json.loads(path.read_text(encoding='utf-8'))

def public_paper(p):
    p=dict(p)
    p['doi']=doi(p.get('doi')) or None
    aliases={'人类':'human','人类研究':'human','人体':'human','动物':'animal','动物实验':'animal','人+动物':'both','未分类':'unknown'}
    if p.get('population') in aliases:p['population']=aliases[p['population']]
    if p.get('population') not in ('human','animal','both','unknown',None):
        raise ValueError('Unknown population schema; review before release')
    # Same compact institution representation as the current shard exporter.
    names=[]
    for a in p.get('affiliations') or []:
        name=a if isinstance(a,str) else a.get('display_name') or a.get('name')
        if name and name not in names:names.append(name)
    for a in p.pop('_authorships',[]) or []:
        for i in a.get('institutions') or []:
            name=i.get('display_name')
            if name and name not in names:names.append(name)
    p['affiliations']=names
    # Internal audit/operator notes belong in the private receipt, not shards.
    p={k:v for k,v in p.items() if not k.startswith('_')}
    return p

def build(baseline_manifest, baseline_dir, additions, approved_ids, output):
    manifest=read(baseline_manifest);baseline_dir=Path(baseline_dir);output=Path(output)
    if manifest.get('format')!='sport-env-litdb-shards':raise ValueError('Unexpected baseline format')
    if output.exists():raise ValueError('Output must be a new release directory')
    base=[];seen=set()
    for sh in manifest['shards']:
        name=Path(sh['path']).name
        if name not in ('papers-1.json','papers-2.json','papers-3.json','papers-4.json'):raise ValueError('Invalid shard path')
        raw=(baseline_dir/name).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=sh['sha256'] or len(raw)!=sh['bytes']:raise ValueError('Baseline SHA256/size mismatch')
        records=json.loads(raw)
        if len(records)!=sh['records']:raise ValueError('Baseline count mismatch')
        for p in records:
            key=wid(p.get('id'))
            if key in seen:raise ValueError('Duplicate/missing baseline ID')
            seen.add(key);base.append(p)
    if len(base)!=manifest['total']:raise ValueError('Manifest total mismatch')
    approved={wid(x) for x in approved_ids}
    if not approved:raise ValueError('Explicitly reviewed paper IDs required')
    choices={}
    for p in additions:
        key=wid(p.get('id'))
        if key in approved:
            if key in choices:raise ValueError('Ambiguous addition ID')
            choices[key]=p
    if set(choices)!=approved:raise ValueError('An approved ID is missing from additions')
    dois={doi(p.get('doi')) for p in base if doi(p.get('doi'))}
    extra=[]
    for key,p in choices.items():
        if key in seen or (doi(p.get('doi')) and doi(p['doi']) in dois):raise ValueError('Addition already in baseline by ID or DOI')
        if p.get('retracted') or p.get('is_retracted'):raise ValueError('Retracted addition requires exclusion')
        if not (p.get('title') or '').strip() or not (p.get('abstract') or '').strip():raise ValueError('Reviewed title and full abstract required')
        if not isinstance(p.get('env'),list) or not p['env'] or any(x not in ENVIRONMENTS for x in p['env']):raise ValueError('Reviewed environment assignment required')
        p=public_paper(p)
        # New additions are historical; preserve all existing IDs and abstracts.
        p['ingest_kind']='historical'
        extra.append(p);seen.add(key)
        if doi(p.get('doi')):dois.add(doi(p['doi']))
    papers=base+extra
    output.parent.mkdir(parents=True,exist_ok=True)
    tmp=Path(tempfile.mkdtemp(prefix='.release-',dir=output.parent))
    try:
        weights=[len(json.dumps(p,ensure_ascii=False).encode()) for p in papers]
        total=sum(weights);bounds=[0];acc=0;pos=0
        for i in range(1,4):
            while pos<len(papers) and acc+weights[pos]<=total*i/4:acc+=weights[pos];pos+=1
            bounds.append(pos)
        bounds.append(len(papers));entries=[]
        for i in range(4):
            chunk=papers[bounds[i]:bounds[i+1]]
            raw=json.dumps(chunk,ensure_ascii=False).encode()
            if len(raw)>50*1024*1024:raise ValueError('Shard exceeds 50 MiB')
            (tmp/f'papers-{i+1}.json').write_bytes(raw)
            entries.append({'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'records':len(chunk)})
        version=hashlib.sha256(''.join(x['sha256'] for x in entries).encode()).hexdigest()[:20]
        for i,e in enumerate(entries,1):e['path']=f'versions/{version}/papers-{i}.json'
        result={'format':'sport-env-litdb-shards','version':version,'generated_at':dt.datetime.now(dt.timezone.utc).isoformat(),'total':len(papers),'shards':entries}
        (tmp/'manifest.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
        receipt={'base_version':manifest['version'],'base_total':len(base),'new_total':len(papers),
                 'approved_additions':[wid(p['id']) for p in extra],'all_existing_records_preserved':True,
                 'abstracts_truncated':0,'status':'staged_not_uploaded','version':version}
        (tmp/'RELEASE.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        tmp.rename(output)
        return receipt
    except BaseException:
        shutil.rmtree(tmp);raise

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--baseline-manifest',type=Path,required=True);p.add_argument('--baseline-dir',type=Path,required=True)
    p.add_argument('--additions',type=Path,required=True);p.add_argument('--approve-id',action='append',required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();print(json.dumps(build(a.baseline_manifest,a.baseline_dir,read(a.additions),a.approve_id,a.output),ensure_ascii=False))

if __name__=='__main__':main()
