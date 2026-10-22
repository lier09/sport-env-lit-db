"""Read-only, reproducible corpus quality checks. Never removes records.

Duplicate titles are review signals, not evidence that reports are identical.
"""
import argparse
from collections import Counter, defaultdict
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import re
from history_reconcile import doi, wid, ENVIRONMENTS


def audit(path, name):
    path = Path(path)
    raw = path.read_bytes()
    records = json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)
    if not isinstance(records, list):
        raise ValueError('Corpus must be a list')
    ids, dois, titles = defaultdict(list), defaultdict(list), defaultdict(list)
    counts = Counter()
    populations, types, environments = Counter(), Counter(), Counter()
    examples = defaultdict(list)
    def issue(kind, p):
        counts[kind] += 1
        if len(examples[kind]) < 12:
            examples[kind].append({'id': p.get('id'), 'doi': p.get('doi'), 'title': p.get('title')})
    for index, p in enumerate(records):
        try:
            key = wid(p.get('id')); ids[key].append(index)
        except ValueError:
            issue('invalid_or_missing_id', p)
        d = doi(p.get('doi'))
        if d:
            dois[d].append(index)
            if not re.fullmatch(r'10\.\d{4,9}/\S+', d): issue('invalid_doi_format', p)
            if p['doi'] != d: counts['noncanonical_doi'] += 1
        else: counts['missing_doi'] += 1
        title = str(p.get('title') or '').strip()
        t = re.sub(r'[^a-z0-9\u4e00-\u9fff]+', '', title.lower())
        if not title: issue('missing_title', p)
        elif t: titles[t].append(index)
        if not str(p.get('abstract') or '').strip(): issue('missing_abstract', p)
        if p.get('retracted') or p.get('is_retracted'): issue('retracted_flag', p)
        year = p.get('year')
        if type(year) is not int or year < 1600 or year > dt.date.today().year + 1:
            issue('invalid_or_missing_year', p)
        cited = p.get('cited')
        if cited is not None and (type(cited) is not int or cited < 0): issue('invalid_citation_count', p)
        populations[str(p.get('population'))] += 1
        types[str(p.get('type'))] += 1
        if name == 'litdb':
            env = p.get('env')
            if not isinstance(env, list): issue('invalid_environment_schema', p)
            elif not env: issue('unclassified_environment', p)
            else:
                environments.update(env)
                if '待分类' in env: issue('pending_environment_review', p)
                if any(e not in ENVIRONMENTS | {'待分类'} for e in env): issue('unknown_environment', p)
            if p.get('population') not in ('human', 'animal', 'both', 'unknown'):
                issue('noncanonical_population', p)
    def groups(mapping):
        duplicates = [rows for rows in mapping.values() if len(rows) > 1]
        return {'groups': len(duplicates), 'extra_records': sum(len(g)-1 for g in duplicates),
                'examples': [[{'id': records[i].get('id'), 'doi': records[i].get('doi'),
                               'title': records[i].get('title')} for i in g] for g in duplicates[:12]]}
    return {'name': name, 'source': str(path.resolve()), 'source_sha256': hashlib.sha256(raw).hexdigest(),
            'records': len(records), 'issues': dict(counts), 'examples': dict(examples),
            'duplicate_id': groups(ids), 'duplicate_doi': groups(dois), 'duplicate_title_review_only': groups(titles),
            'populations': dict(populations), 'types': dict(types), 'environments': dict(environments)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--handover', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = {'scope': 'provided snapshots; not live VM state', 'created_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'corpora': [audit(args.handover/'03_data'/name/file, name) for name, file in
                          [('litdb', 'merged.json.gz'), ('consensus', 'consensus.json.gz'), ('perfmod', 'perfmod.json.gz')]]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps([{'name': c['name'], 'records': c['records'], 'issues': c['issues'],
                       'duplicate_doi_groups': c['duplicate_doi']['groups'],
                       'duplicate_title_groups': c['duplicate_title_review_only']['groups']} for c in result['corpora']], ensure_ascii=False))


if __name__ == '__main__': main()
