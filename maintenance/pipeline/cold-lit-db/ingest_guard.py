"""Conservative admission and identity helpers shared by all three daily jobs.

Review evidence is durable and independent of the canonical data transaction.
No networking, publication or retroactive removal of existing papers.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import contextlib
import contextvars
from openalex_runtime import PipelineError, atomic_json

_sink = contextvars.ContextVar('review_sink', default=None)


@contextlib.contextmanager
def capture_reviews():
    records = []
    token = _sink.set(records)
    try: yield records
    finally: _sink.reset(token)


def require_managed():
    if os.environ.get('OA_MANAGED') != '1':
        raise PipelineError('Use run_pipeline.py; direct writers are disabled')


def identity(p):
    out = set()
    raw = str(p.get('id') or '').strip().split('/')[-1].upper()
    if re.fullmatch(r'W\d+', raw): out.add('I:' + raw)
    doi = re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)', '', str(p.get('doi') or '').strip(), flags=re.I).lower()
    if doi: out.add('D:' + doi)
    # A shared title alone is never sufficient to merge distinct DOI reports.
    return out


def review(base, raw, reason, **context):
    if _sink.get() is not None:
        _sink.get().append({'reason': reason, **context})
        return
    base = Path(base)
    path = base/'data'/('pending_review_' + dt.date.today().isoformat() + '.json')
    records = json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    if not isinstance(records, list): raise PipelineError('Invalid pending-review file; do not overwrite')
    ids = identity(raw)
    q = context.get('query', '')
    item = {'id': raw.get('id'), 'doi': raw.get('doi'), 'title': raw.get('title'), 'reason': reason,
            'raw': raw, **context}
    # Replace the same decision on retry; preserve different query contexts.
    for i, old in enumerate(records):
        if ids.intersection(identity(old)) and old.get('reason') == reason and old.get('query', '') == q:
            records[i] = item
            break
    else: records.append(item)
    atomic_json(path, records)


def admissible(base, raw, abstract, **context):
    if not identity(raw) or not (raw.get('title') or '').strip():
        review(base, raw, 'missing_identifier_or_title', **context); return False
    if raw.get('is_retracted') or raw.get('retracted'):
        review(base, raw, 'retracted_requires_review', **context); return False
    if not (abstract or '').strip():
        review(base, raw, 'missing_abstract_requires_enrichment_review', **context); return False
    if not raw.get('topics'):
        review(base, raw, 'missing_topics_requires_review', **context); return False
    return True


def blocked(path):
    path = Path(path)
    if not path.exists():
        raise PipelineError('Expected dedup blocklist is missing; restore/review it before collection')
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or not isinstance(data.get('ids'), list):
        raise PipelineError('Invalid dedup blocklist; do not silently disable it')
    keys = set()
    for i in data['ids']:
        row = identity({'id': i})
        if not row: raise PipelineError('Invalid blocklist ID')
        keys.update(row)
    for d in data.get('dois', []): keys.update(identity({'doi': d}))
    return keys
