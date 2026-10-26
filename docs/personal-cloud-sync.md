# Personal cloud sync and recovery

The literature corpus remains public. Personal sync uses the existing Supabase Auth account and project, with RLS on every document, version and checkpoint. There are no service-role keys in the browser. API/AI keys and sessions are excluded from sync and backups.

## User flow

Open **个人资料 · 云同步**, log in, and wait for **已同步到账号**. Saved notes, their image/PDF attachments, memo groups, followed authors/journals, favorites, folders, annotations and supported personal preferences synchronize. Anonymous notes stay local until the owner explicitly chooses **归入本账号：本机未归属资料**. Other accounts' local notes are not included.

Local saves remain the first durable step. A failed cloud operation is displayed as unsynced; it does not delete local content. Dirty editors are not overwritten. The sync UI starts independently of corpus loading, so backup access does not require successful literature downloads.

Notes keep the original IndexedDB schema/version. The optional `_account` field isolates accounts; the original unowned memo/group records remain available to the anonymous workspace. Group catalogs are account-scoped after association. Attachments are content-addressed with SHA-256, private, and immutable from the client. Each attachment is limited to 25MB; exceeding this limit is a visible sync failure, not a successful partial upload.

## Conflicts and restore

Writes use expected revisions. Stale writes return no row and are retried after reconciliation. First connection unions existing preference objects rather than interpreting a new/cleared browser as a delete request. Known-base merges propagate intentional removals. Simultaneous note edits produce a visible conflict copy. Conflicting preference/group alternatives are preserved in server history.

**历史版本与每日检查点** restores a selected document version by creating a newer revision. Note trash is reversible; the browser cannot hard-delete server documents, versions or blobs.

## Backups and limits

- `personal_versions` retains current plus at least 30 days of previous revisions (cleanup threshold: 35 days).
- `litdb-personal-daily` runs at 19:20 UTC / 03:20 Beijing time and stores daily document checkpoints in a separate table, even with all browsers closed. A first-write checkpoint also exists for each active day. These checkpoints refer to immutable private attachment objects; they are **not** an independent copy of the entire Supabase project.
- **导出完整备份** includes note text, group/follow/folder data and actual attachment bytes. **导入完整备份** preserves existing notes and creates recovery copies when IDs conflict. Legacy notebook v1 and personal preference v1 exports remain supported by their original import controls.
- **开启电脑独立备份** asks the user to select a real directory using the browser's File System Access API. After a successful sync, it writes a full JSON backup once per day while the app is in use. Closing the app stops this local job. Clearing site data removes the saved directory handle, but does not delete files already written to that directory. The user must reselect the directory afterward.
- A directory on another partition of the same SSD protects against browser-data deletion, not physical SSD failure. An external/off-device copy provides the latter protection.
- The local full-backup importer limits files to 25MB individually and 256MB combined. Server document history has a 64MB per-account guard; reaching it produces an explicit error and requires exporting/contacting the administrator. Attachments are deduplicated, not copied into each version.
- Figure-study PDFs/images in `litdb-figures` are a separate workspace and are **not** covered by this release. Its original export remains necessary. Do not label the sync UI as an all-application backup.

## Deployment and verification

Apply `supabase/migrations/202610260001_personal_sync.sql` once as project administrator. It adds only personal tables, private policies, functions, a private attachment bucket and a cron job; corpus shards and the review overlay remain unchanged. Never publish private backup data to the GitHub repository.

Run `supabase/tests/personal-sync.sql` in the project SQL Editor. It checks the real private bucket, active cron, two-revision writes, stale-write rejection and cross-account RLS, and rolls all synthetic data back. Also run `npm test`.

On 2026-10-26 the migration was applied to `ywmjbivuibxsgjcmekob`. The SQL acceptance query returned PASS with its synthetic writes rolled back. Local tests cover fresh-device restoration with attachment bytes, offline retries, simultaneous edits, account isolation, first-connection merge semantics and corrupted backup rejection. This does not mean the user's existing browser has already logged in, claimed unowned records, or granted a directory handle.
