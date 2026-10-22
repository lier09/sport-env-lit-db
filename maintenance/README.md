# Historical reconciliation and data-only release

## Audited daily runtime (2026-10-22)

`pipeline/` contains reviewed replacements for the three daily collectors and
shared runtime, not a website template. Install with `install_pipeline.py`:
preflight is the default, original file hashes must match, the actual writer
and enqueue locks must be free, and every replaced file is backed up. Do not
copy the archive's SQLite/queue snapshots over the current VM. Unfinished runs
need an explicitly reviewed `--accept-pending-replay`; their original scope,
date window, retry time and raw-page cache are retained. A code difference must
be inspected, never bypassed with a force flag.

The patched collectors only change local data. They do not rebuild old HTML,
increment build source versions or upload. Missing abstracts/topics, retractions,
and uncertain exercise relationships are saved with raw metadata for review.
They are not automatically admitted, nor assumed irrelevant. This conservative
policy increases manual review. The public environment review overlay handles
environment assignment of existing records; the new raw intake queue is separate
and is **not yet automatically displayed in that public review workspace**.

Identity uses normalized ID and DOI, not title alone. The dedup blocklist is
required and applies to all three daily jobs. Malformed/missing blocklists block
collection. Known papers are not retroactively deleted or relabeled. Full daily
intake entries and abstracts are retained. Duplicate/overlapping API pages cannot
be certified complete merely because their row count matches `meta.count`.

Before each managed job, a recoverable journal backs up the canonical output set.
Failures restore that set; after a killed process, the next managed invocation
recovers it before any job runs. Durable raw pages and pending-review evidence
survive. This is process-interruption recovery under the shared writer lock,
not a simultaneous multi-file snapshot for external readers. Publish only staged,
verified releases. Manual scripts bypassing the managed entry still require
separate review and the same lock; they must not run alongside these collectors.

`audit_corpus.py` profiles the supplied three snapshots without editing them.
`normalize_corpus.py` stages deterministic schema repairs without deleting records
or inferring human participants. Its explicit `--apply` mode uses the installed
writer lock, verifies a backup and replaces canonical JSON atomically. It never
uploads. Run schema repair on the **current** canonical data, not an old snapshot.

Daily and historical collection now share `effective_queries()`, including the
seven synonym queries. Patched rules change the history fingerprint: retain old
ledgers and start a new `history-v2-*.sqlite3`, rather than reusing an incompatible
unfinished ledger. The historical worker captures review decisions in its own
ledger without writing to canonical data directories.

The historical/release tools below supplement the daily ingestion pipeline.
They do not deploy HTML, truncate abstracts, upload data, delete canonical records,
or advance its successful-date watermark. The audited daily runtime above still
advances its own watermark only after successful collection. No credentials
belong in this repo.

## Why this is needed

Publication-date windows miss older records newly discovered by OpenAlex. A
successful recent-date query does not establish historical coverage. The handover
logs also contain failed/skipped historical queries. `from_updated_date` and
`from_created_date` are paid sync filters; these tools do not assume that a free
key grants access. They reuse existing configured queries across the full history
up to a frozen upper publication date, and preserve a decision for each record.

## Install in the existing Linux workspace

Copy `history_reconcile.py` into `~/workspace/cold-lit-db/`. It imports the actual
`daily_update.py`, `openalex_runtime.py`, `openalex_auth.py`, and `run_pipeline.py`
there. Keep the existing key and shared `OA_STATE_DIR`. Do not copy a Windows
staging state over a live Linux state, reset a cooldown, or overwrite the website
with the handover's obsolete `site/` template.

One bounded run, under the SAME writer lock and quota clock as daily jobs:

```sh
python3 ~/workspace/cold-lit-db/history_reconcile.py \
  --workspace ~/workspace/cold-lit-db \
  --ledger ~/.local/state/litdb-openalex/history.sqlite3 \
  --pages 8 --rolling
```

`--pages` limits work per invocation, **not the total pages of a query**. Each
invocation visits different pending query groups, and subsequent invocations
resume at the least recently visited group. An API/global cooldown propagates as
exit 75; failed or count-drifting queries are never marked complete. The existing
daily-task budget reservation remains active. Cursor access is used when the
existing key is configured; reaching the basic 10,000-record page boundary without
it is explicitly incomplete and requires splitting the query/access configuration.

Start with a reviewed high-oxygen campaign using `--env 高氧` and its own ledger
name, then use a separate all-environment ledger. Do not change query restrictions
or source rules for an unfinished ledger. Repeated scheduled invocations may call
the bounded command; this repository does not create or enable a scheduler. Exit
75 is pending, not success or a completed historical pass. Continue to use the
daily increment alongside this historical process.

`--rolling` retains the current unfinished campaign across days. Only after all
queries finish does a later-day invocation create a new dated campaign. Changed
rules/configuration require a reviewed new ledger. `needs_review` queries block
full-campaign completion rather than silently vanishing. Counts/IDs drifting in
the live service may require a deliberate new pass; this is not an immutable
OpenAlex snapshot or a guarantee of perfect recall. No runtime is available when
the execution host is off. Frequency and completion time depend on actual quota.

Inspect progress with the same arguments plus `--status`. Next to the SQLite
ledger is a `.candidates.json` export. It includes raw records, matching queries,
accepted-rule candidates and unresolved records. Missing abstracts require
enrichment and review; retractions are flagged. Known IDs/DOIs and the current
dedup blocklist are respected. Multiple reports are not assumed independent.

## Data-only release after review

Use `build_data_release.py` with a SHA256-verified online baseline and additions
that have actually been reviewed. It accepts explicit OpenAlex IDs only, refuses
duplicates and retracted/missing-abstract additions, and creates a NEW directory.
Only listed IDs are added. Existing records/IDs and complete abstracts stay intact.
Chinese population aliases are normalized to the frontend's `human/animal/both`.

```sh
python3 maintenance/build_data_release.py \
  --baseline-manifest /verified-baseline/manifest.json \
  --baseline-dir /verified-baseline \
  --additions /reviewed/papers.json \
  --approve-id W4414569677 \
  --output /new-staging-release
```

The addition file is a list of normal paper records, not the historical export's
wrapper object. Enrichment provenance must be checked before approving an ID.
Verify the produced manifest hashes, counts and the target paper's full abstract
and human filter through the current frontend. Upload immutable `versions/<id>/`
objects first, verify downloaded objects, then switch the public manifest LAST.
Retain the old manifest for rollback; do not publish the unrelated unreviewed local
batch, rebuild HTML from old templates, or modify public environment-review tables.

Uploads and remote scheduling require actual access to the target runtime/project.
A handover document claiming VM availability is not a connection or deployment
credential. These tools cannot by themselves access a Muse/Hatch VM.

## Verification

```sh
python3 -m unittest discover -s maintenance/tests -v
```

Tests cover fairness, restart, incomplete pages, drifting counts, duplicate pages,
abstract/retraction handling, baseline verification, explicitly reviewed IDs,
population normalization and full-abstract preservation. Full ingestion tests
should additionally replay real source records against the actual exported rules.
