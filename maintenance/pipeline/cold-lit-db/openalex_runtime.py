"""Shared, durable OpenAlex transport. Standard library only; no startup I/O.

All cooperating processes use the same SQLite request clock and cooldown.
Page payloads are committed before the caller receives them. A failed run
replays saved pages locally, then requests only missing pages. This is a
download checkpoint, not a promise that a live API is an immutable snapshot.
"""
import contextlib
import datetime as dt
import email.utils
import hashlib
import http.client
import json
import os
from pathlib import Path
import random
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

import openalex_auth


class PipelineError(RuntimeError):
    """Do not advance the successful watermark or publish this run."""


class Deferred(PipelineError):
    def __init__(self, reason, retry_at):
        self.reason, self.retry_at = reason, retry_at
        super().__init__(f"{reason}; retry after {dt.datetime.fromtimestamp(retry_at, dt.timezone.utc).isoformat()}")


def atomic_json(path, value, indent=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    with tmp.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=indent)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    if os.name == "posix":
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def redact(value):
    value = str(value)
    key = openalex_auth.get_key()
    if key:
        value = value.replace(key, "[REDACTED]").replace(urllib.parse.quote(key, safe=""), "[REDACTED]")
    return re.sub(r'(?i)(api[_-]?key[\s"\x27:=]+)[^\s&"\x27,}]+', r'\1[REDACTED]', value)[:2000]


def canonical(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname != "api.openalex.org" or parts.port not in (None, 443):
        raise PipelineError("Only https://api.openalex.org requests are allowed")
    params = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
              if k.lower() not in ("api_key", "api-key")]
    return urllib.parse.urlunsplit(("https", "api.openalex.org", parts.path, urllib.parse.urlencode(sorted(params)), ""))


def retry_seconds(headers, now):
    raw = headers.get("Retry-After")
    if not raw:
        return 0
    try:
        return max(0, float(raw))
    except ValueError:
        try:
            return max(0, email.utils.parsedate_to_datetime(raw).timestamp() - now)
        except (ValueError, TypeError, OverflowError):
            return 0


def number(headers, name):
    try:
        return float(headers.get(name))
    except (ValueError, TypeError):
        return None


class Client:
    def __init__(self, root=None, scope=None, opener=None, clock=None, sleeper=None, interval=None):
        self.root = Path(root or os.environ.get("OA_STATE_DIR", "~/.local/state/litdb-openalex")).expanduser()
        self.scope = scope or os.environ.get("OA_RUN_ID", "direct-" + dt.date.today().isoformat())
        self.opener = opener or urllib.request.urlopen
        self.clock = clock or time.time
        self.sleep = sleeper or time.sleep
        self.interval = max(0, float(interval if interval is not None else os.environ.get("OA_INTERVAL", "5")))
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.dbpath = self.root / "requests.sqlite3"
        with self.db() as conn:
            conn.executescript("""
              CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS pages (scope TEXT, request TEXT, payload TEXT,
                saved REAL, PRIMARY KEY(scope, request));
              CREATE TABLE IF NOT EXISTS events (at REAL, scope TEXT, kind TEXT, detail TEXT);
            """)
        with contextlib.suppress(OSError):
            os.chmod(self.dbpath, 0o600)
        self.event("configuration", {"auth_configured": openalex_auth.has_key(), "interval": self.interval})

    @contextlib.contextmanager
    def db(self):
        conn = sqlite3.connect(self.dbpath, timeout=30)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def event(self, kind, detail):
        with self.db() as conn:
            conn.execute("INSERT INTO events VALUES (?,?,?,?)", (self.clock(), self.scope, kind, redact(json.dumps(detail, ensure_ascii=False))))

    @staticmethod
    def get(conn, key, default=0):
        row = conn.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    @staticmethod
    def put(conn, key, value):
        conn.execute("INSERT OR REPLACE INTO state VALUES (?,?)", (key, json.dumps(value)))

    def pause(self, until, reason):
        with self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            self.put(conn, "cooldown", max(until, self.get(conn, "cooldown")))
        self.event("deferred", {"reason": reason, "retry_at": until})

    def slot(self):
        while True:
            now = self.clock()
            deadline = float(os.environ.get("OA_DEADLINE", "inf"))
            if now >= deadline:
                raise Deferred("time_slice_finished", now + 60)
            if os.environ.get("OA_BACKGROUND") == "1":
                for path in (self.root / "queue").glob("*.json"):
                    item = json.loads(path.read_text(encoding="utf-8"))
                    if item.get("priority", 10) < 10 and item.get("status") == "pending" and item.get("retry_at", 0) <= now:
                        raise Deferred("yield_to_daily_update", now + 60)
            with self.db() as conn:
                conn.execute("BEGIN IMMEDIATE")
                cooldown = self.get(conn, "cooldown")
                if cooldown > now:
                    raise Deferred("shared_cooldown", cooldown)
                if os.environ.get("OA_BACKGROUND") == "1":
                    remain, limit = self.get(conn, "remaining", None), self.get(conn, "limit", None)
                    reset = self.get(conn, "reset_at", 0)
                    if reset > now and remain is not None and limit and remain < limit * 0.20:
                        raise Deferred("reserve_budget_for_daily_updates", reset)
                wait = max(0, self.get(conn, "next_request") - now)
                if wait <= 0:
                    self.put(conn, "next_request", now + self.interval)
                    return
            if now + wait >= deadline:
                raise Deferred("time_slice_finished", now + wait)
            self.sleep(min(wait, 30))

    def headers(self, headers):
        now = self.clock()
        values = {"remaining": number(headers, "X-RateLimit-Remaining"),
                  "limit": number(headers, "X-RateLimit-Limit"),
                  "used": number(headers, "X-RateLimit-Credits-Used")}
        reset = number(headers, "X-RateLimit-Reset")
        # Official header is seconds until reset, not a Unix timestamp.
        if reset is not None:
            values["reset_at"] = now + max(0, reset)
        with self.db() as conn:
            for key, value in values.items():
                if value is not None:
                    self.put(conn, key, value)
        return {k: v for k, v in values.items() if v is not None}

    def fetch(self, url, retries=3):
        clean = canonical(url)
        request_id = hashlib.sha256(clean.encode()).hexdigest()
        with self.db() as conn:
            row = conn.execute("SELECT payload FROM pages WHERE scope=? AND request=?", (self.scope, request_id)).fetchone()
        if row:
            return json.loads(row[0])
        # Attach credentials only after validation, never to the cache key or log.
        signed = openalex_auth.with_key(clean)
        for attempt in range(retries + 1):
            self.slot()
            try:
                req = urllib.request.Request(signed, headers={"User-Agent": "EnvLitDB/2.0 (resumable metadata collection)"})
                with self.opener(req, timeout=60) as response:
                    status = self.headers(response.headers)
                    raw = response.read()
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError("OpenAlex JSON must be an object")
                if "/works" == urllib.parse.urlsplit(clean).path.rstrip("/"):
                    if not isinstance(data.get("results"), list) or not isinstance(data.get("meta"), dict):
                        raise ValueError("Missing results/meta in OpenAlex response")
                with self.db() as conn:
                    conn.execute("INSERT OR REPLACE INTO pages VALUES (?,?,?,?)",
                                 (self.scope, request_id, json.dumps(data, ensure_ascii=False), self.clock()))
                self.event("response", {"request": request_id, "http": 200, "bytes": len(raw), **status})
                if status.get("remaining") == 0:
                    self.pause(status.get("reset_at", self.next_reset()), "daily_budget_exhausted")
                return data
            except urllib.error.HTTPError as exc:
                headers = exc.headers or {}
                status = self.headers(headers)
                try:
                    body = redact(exc.read(8192).decode("utf-8", "replace"))
                finally:
                    exc.close()
                self.event("http_error", {"request": request_id, "http": exc.code, "body": body, **status})
                if exc.code == 429:
                    budget = status.get("remaining") == 0 or bool(re.search(r"daily|budget|credits? (?:exceeded|exhausted)|quota", body, re.I))
                    wait = retry_seconds(headers, self.clock())
                    if budget:
                        until = max(self.clock() + wait, status.get("reset_at", self.next_reset()))
                        self.pause(until, "daily_budget_exhausted")
                        raise Deferred("daily_budget_exhausted", until) from None
                    wait = max(wait, min(60, 5 * 2 ** attempt) + random.uniform(0, 2))
                    until = self.clock() + wait
                    self.pause(until, "request_rate_limited")
                    if wait > 60 or attempt == retries:
                        raise Deferred("request_rate_limited", until) from None
                    self.sleep(wait)
                    continue
                if exc.code not in (408, 500, 502, 503, 504):
                    raise PipelineError(f"OpenAlex HTTP {exc.code}; see redacted events (credentials/query syntax/access)") from None
                wait = max(retry_seconds(headers, self.clock()), min(60, 5 * 2 ** attempt))
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, ValueError) as exc:
                self.event("download_error", {"request": request_id, "type": type(exc).__name__})
                wait = min(60, 5 * 2 ** attempt) + random.uniform(0, 2)
            if attempt == retries or wait > 60:
                until = self.clock() + max(wait, 60)
                self.pause(until, "request_incomplete")
                raise Deferred("request_incomplete", until)
            self.sleep(wait)
        raise PipelineError("Request did not complete")

    def next_reset(self):
        now = dt.datetime.fromtimestamp(self.clock(), dt.timezone.utc)
        return (now.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)).timestamp()

    def iter_pages(self, params):
        """Full pagination: no silent 5/20 page cap; cursor when keyed.

        Without a key the official 10,000-result boundary is an explicit error,
        never a successful truncated result. Configure a key or split the query.
        """
        params = dict(params)
        params.pop("page", None)
        params.pop("cursor", None)
        per = min(100, max(1, int(params.get("per-page", params.pop("per_page", 50)))))
        params["per-page"] = per
        cursor_mode = openalex_auth.has_key()
        params["cursor" if cursor_mode else "page"] = "*" if cursor_mode else 1
        fingerprint = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
        self.event("query_started", {"query": fingerprint})
        total, downloaded, cursors, seen_ids = None, 0, set(), set()
        if cursor_mode: cursors.add('*')
        while True:
            if not cursor_mode and (params["page"] - 1) * per >= 10000:
                raise PipelineError("Unfinished query exceeds basic paging limit; configure a free API key for cursor paging")
            data = self.fetch("https://api.openalex.org/works?" + urllib.parse.urlencode(params))
            count = data["meta"].get("count")
            if type(count) is not int or count < 0:
                raise PipelineError("Invalid total result count")
            if total is None:
                total = count
            elif count != total:
                raise PipelineError("Live result count changed during pagination; review/restart this query with a new run scope")
            records = data['results']
            if len(records) > per: raise PipelineError('Oversized result page')
            ids = [(p.get('id') or '').rstrip('/').split('/')[-1].upper() for p in records]
            if any(not re.fullmatch(r'W\d+', i) for i in ids):
                raise PipelineError('Invalid/missing result ID')
            if len(ids) != len(set(ids)) or seen_ids.intersection(ids):
                raise PipelineError('Repeated paper IDs; pagination coverage not established')
            seen_ids.update(ids)
            downloaded += len(records)
            if downloaded > total: raise PipelineError('Downloaded count differs from declared total')
            # Validate each page BEFORE allowing callers to process its records.
            if downloaded < total and len(records) < per:
                raise PipelineError('Short page before declared total; query is incomplete')
            if downloaded < total and cursor_mode:
                nxt = data['meta'].get('next_cursor')
                if not nxt or nxt in cursors: raise PipelineError('Missing or repeated pagination cursor')
            yield data
            if downloaded >= total:
                if downloaded != total:
                    raise PipelineError("Downloaded count differs from declared total")
                break
            if len(data["results"]) < per:
                raise PipelineError("Short page before declared total; query is incomplete")
            if cursor_mode:
                nxt = data["meta"].get("next_cursor")
                if not nxt or nxt in cursors:
                    raise PipelineError("Missing or repeated pagination cursor")
                cursors.add(nxt)
                params["cursor"] = nxt
            else:
                params["page"] += 1
        self.event("query_complete", {"query": fingerprint, "downloaded": downloaded, "total": total})


_client = None


def client():
    global _client
    if _client is None:
        _client = Client()
    return _client


def fetch(url, retries=3):
    return client().fetch(url, retries)


def iter_pages(params):
    return client().iter_pages(params)
