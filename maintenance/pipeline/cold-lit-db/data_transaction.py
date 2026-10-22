"""Recoverable multi-file data writes under the pipeline's exclusive OS lock.

Each output remains an atomic file. The journal restores the whole previous
set after interruption; no public upload, website source or review evidence
is part of the transaction. External readers must use published releases.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from openalex_runtime import atomic_json, PipelineError

FILES = {
    'litdb': ('cold-lit-db', ['merged.json', 'authorships.json', 'daily_new.json', 'update_state.json', 'analytics.json']),
    'consensus': ('consensus-db', ['consensus.json', 'daily_new.json']),
    'perfmod': ('perfmod-db', ['perfmod.json', 'daily_new.json']),
}


def targets(workspace, job):
    folder, names = FILES[job]
    return [Path(workspace).resolve()/folder/'data'/name for name in names]


def recover(root, workspace):
    root = Path(root).resolve()
    journal = root/'write-transaction.json'
    if not journal.exists(): return False
    data = json.loads(journal.read_text(encoding='utf-8'))
    allowed = targets(workspace, data['job'])
    backup = Path(data['backup']).resolve()
    if backup.parent != root/'transactions' or not backup.name.startswith('write-'):
        raise PipelineError('Invalid transaction backup location')
    if data['targets'] != [str(p) for p in allowed]:
        raise PipelineError('Transaction workspace changed; manual recovery required')
    # Verify the entire backup before touching ANY target.
    for i, entry in enumerate(data['files']):
        if entry is not None:
            raw = (backup/str(i)).read_bytes()
            if hashlib.sha256(raw).hexdigest() != entry:
                raise PipelineError('Transaction backup hash mismatch')
    if len(data['files']) != len(allowed): raise PipelineError('Invalid transaction file list')
    for i, (path, entry) in enumerate(zip(allowed, data['files'])):
        if entry is None:
            if path.exists(): path.unlink()
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name+'.recover.tmp')
            shutil.copyfile(backup/str(i), tmp)
            os.replace(tmp, path)
    journal.unlink()
    cleanup(root, backup)
    return True


def cleanup(root, backup):
    root, backup = Path(root).resolve(), Path(backup).resolve()
    if backup.parent != root/'transactions' or not backup.name.startswith('write-'):
        raise PipelineError('Invalid transaction cleanup path')
    # Only files created by this module; never recursive deletion.
    for path in backup.iterdir(): path.unlink()
    backup.rmdir()


class Transaction:
    def __init__(self, root, workspace, job):
        self.root, self.workspace, self.job = Path(root).resolve(), Path(workspace).resolve(), job
        self.journal = self.root/'write-transaction.json'

    def begin(self):
        recover(self.root, self.workspace)
        parent = self.root/'transactions'; parent.mkdir(parents=True, exist_ok=True)
        self.backup = Path(tempfile.mkdtemp(prefix='write-', dir=parent))
        paths, entries = targets(self.workspace, self.job), []
        try:
            for i, path in enumerate(paths):
                if not path.exists(): entries.append(None); continue
                dst = self.backup/str(i)
                with path.open('rb') as source, dst.open('wb') as stream:
                    shutil.copyfileobj(source, stream); stream.flush(); os.fsync(stream.fileno())
                entries.append(hashlib.sha256(dst.read_bytes()).hexdigest())
        except BaseException:
            cleanup(self.root, self.backup)
            raise
        atomic_json(self.journal, {'job': self.job, 'targets': [str(p) for p in paths],
                                   'backup': str(self.backup), 'files': entries})

    def commit(self):
        self.journal.unlink()
        cleanup(self.root, self.backup)

    def rollback(self):
        recover(self.root, self.workspace)
