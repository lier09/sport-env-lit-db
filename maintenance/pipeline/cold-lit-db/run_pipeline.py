#!/usr/bin/env python3
"""Durable local job queue. No uploads or scheduler API calls.

Usage: python3 ~/workspace/cold-lit-db/run_pipeline.py --job litdb
       python3 ~/workspace/cold-lit-db/run_pipeline.py --job consensus
       python3 ~/workspace/cold-lit-db/run_pipeline.py --job perfmod
       python3 ~/workspace/cold-lit-db/run_pipeline.py --job rewash --retry-list logs/rewash_retry_failed_20261016.txt
       python3 ~/workspace/cold-lit-db/run_pipeline.py --drain
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import uuid

from openalex_runtime import atomic_json
from data_transaction import recover

JOBS = {"litdb": (0, "cold-lit-db", "daily_update.py"),
        "consensus": (1, "consensus-db", "daily_update.py"),
        "perfmod": (2, "perfmod-db", "daily_update.py")}


@contextlib.contextmanager
def lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        stream.seek(0)
        stream.write(b"0")
        stream.flush()
        try:
            if os.name == "nt":
                import msvcrt
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            yield False
            return
        try:
            yield True
        finally:
            if os.name == "nt":
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def sources(workspace):
    out = {}
    for folder, names in {
        "cold-lit-db": ["daily_update.py", "openalex_auth.py", "openalex_runtime.py", "safe_entry.py",
                       "run_pipeline.py", "ingest_guard.py", "data_transaction.py"],
        "consensus-db": ["daily_update.py", "collect.py"],
        "perfmod-db": ["daily_update.py", "collect.py"],
    }.items():
        for name in names:
            path = workspace / folder / name
            out[f"{folder}/{name}"] = hashlib.sha256(path.read_bytes()).hexdigest()
    # A query or blocklist change also invalidates replay/completion receipts.
    for pattern in ("*/data/queries.json", "cold-lit-db/data/dedup_blocklist*.json"):
        for path in workspace.glob(pattern):
            out[path.relative_to(workspace).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def enqueue(root, workspace, name, full=False, retry_list=None, new_run=False):
    path = root / "queue" / f"{name}.json"
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        if new_run:
            atomic_json(root / "history" / (old["scope"] + ".json"), old)
        elif old["status"] != "complete":
            print(f"Resuming saved {name} run with its original arguments/window.")
            return old
        elif old["day"] == dt.date.today().isoformat():
            return old
    priority, folder, script = JOBS[name]
    argv = [str(workspace / folder / script)]
    if name == "litdb" and not full:
        statefile = workspace / folder / "data" / "update_state.json"
        state = json.loads(statefile.read_text(encoding="utf-8")) if statefile.exists() else {}
        # Freeze both edges across overnight retries. daily_update subtracts the
        # seven-day overlap from --from itself; never subtract twice here.
        start = state.get("last_run") or (dt.date.today() - dt.timedelta(days=1)).isoformat()
        argv += ["--from", start, "--to", dt.date.today().isoformat()]
    elif name == "consensus" or (full and name == "litdb"):
        argv += ["--full"]
    elif name == "rewash":
        argv += ["--retry-list", retry_list] if retry_list else ["--full"]
    item = {"job": name, "scope": name + "-" + uuid.uuid4().hex,
            "day": dt.date.today().isoformat(), "priority": priority,
            "workspace": str(workspace), "argv": argv, "cwd": str(workspace / folder),
            "sources": sources(workspace), "status": "pending", "retry_at": 0}
    atomic_json(path, item)
    return item


def pending(root):
    out = []
    for path in (root / "queue").glob("*.json"):
        item = json.loads(path.read_text(encoding="utf-8"))
        # A process killed by VM restart remains running; the global OS lock is
        # released by the OS, so it can safely resume as a pending job.
        if item["status"] in ("pending", "running") and item.get("retry_at", 0) <= time.time():
            out.append((item["priority"], path, item))
    return sorted(out, key=lambda row: (row[0], row[2]["day"]))


def execute(root, item, path, deadline=None):
    if sources(Path(item["workspace"])) != item["sources"]:
        item.update(status="blocked", error="Code/config changed during unfinished run; archive queue receipt and start a new scope after review")
        atomic_json(path, item)
        return 78
    item.update(status="running", retry_at=0, started=time.time())
    atomic_json(path, item)
    env = os.environ.copy()
    env.update(OA_STATE_DIR=str(root), OA_RUN_ID=item["scope"], OA_MANAGED="1",
               LITDB_WORKSPACE=item['workspace'],
               OA_JOB=item["job"], OA_BACKGROUND="1" if item["priority"] >= 10 else "0",
               OA_DEADLINE=str(min(deadline if deadline is not None else float("inf"),
                                   time.time() + (300 if item["priority"] >= 10 else 1200))))
    # The subprocess handles safe exception reporting; its command has no key.
    result = subprocess.run([sys.executable, str(Path(__file__).with_name("safe_entry.py")), *item["argv"]],
                            cwd=item["cwd"], env=env)
    statusfile = root / "outcomes" / (item["scope"] + ".json")
    outcome = json.loads(statusfile.read_text(encoding="utf-8")) if statusfile.exists() else {}
    if result.returncode == 0:
        item.update(status="complete", completed=time.time(), retry_at=0)
    elif result.returncode == 78:
        item.update(status="blocked", error=outcome.get("reason", "Permanent error; inspect run log"))
    else:
        item.update(status="pending", retry_at=max(time.time() + 60, outcome.get("retry_at", time.time() + 600)),
                    error=outcome.get("reason", "Interrupted/error; saved pages retained"))
    item["exit_code"] = result.returncode
    atomic_json(path, item)
    if result.returncode == 0 and (root / "requests.sqlite3").exists():
        # Pending/killed runs retain ALL pages. Completed scopes are no longer
        # used, so release their cache space; retain a month of audit events.
        with sqlite3.connect(root / "requests.sqlite3", timeout=30) as conn:
            conn.execute("DELETE FROM pages WHERE scope=?", (item["scope"],))
            conn.execute("DELETE FROM events WHERE at<?", (time.time() - 30*86400,))
            conn.execute("PRAGMA incremental_vacuum")
    print(json.dumps({k: item[k] for k in ("job", "status", "retry_at", "exit_code")}, ensure_ascii=False), flush=True)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job", choices=JOBS)
    parser.add_argument("--drain", action="store_true")
    parser.add_argument("--workspace", type=Path, default=Path("~/workspace").expanduser())
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--new-run", action="store_true", help="Archive an old receipt and deliberately restart with a fresh page-cache scope")
    parser.add_argument("--retry-list")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    root = Path(os.environ.get("OA_STATE_DIR", "~/.local/state/litdb-openalex")).expanduser()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    workspace = args.workspace.expanduser().resolve()
    if args.status:
        for path in (root / "queue").glob("*.json"):
            item = json.loads(path.read_text(encoding="utf-8"))
            print(json.dumps({k: item.get(k) for k in ("job", "status", "retry_at", "error", "exit_code")}, ensure_ascii=False))
        return 0
    if not args.job and not args.drain:
        parser.error("Specify --job or --drain")
    # One enqueue lock avoids racing cron invocations for the same job.
    if args.job:
        with lock(root / "enqueue.lock") as acquired:
            if not acquired:
                return 75
            enqueue(root, workspace, args.job, args.full, args.retry_list, args.new_run)
    with lock(root / "writer.lock") as acquired:
        if not acquired:
            print("Queued; another managed writer is running.")
            return 75
        recover(root, workspace)
        deadline = time.time() + 1200
        # Bound one invocation. Repeated --drain wakes resume the durable queue.
        for _ in range(4):
            if time.time() >= deadline:
                break
            jobs = pending(root)
            if not jobs:
                break
            _, path, item = jobs[0]
            execute(root, item, path, deadline)
        states = [json.loads(path.read_text(encoding="utf-8"))["status"]
                  for path in (root / "queue").glob("*.json")]
        if "blocked" in states:
            return 78
        return 75 if any(state != "complete" for state in states) else 0


if __name__ == "__main__":
    if hasattr(os, "umask"):
        os.umask(0o077)
    sys.exit(main())
