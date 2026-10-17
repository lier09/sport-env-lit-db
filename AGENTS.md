# Working on the literature database

- Start from the latest `origin/main`; inspect and preserve newer changes before editing.
- `index.html` is the live application. Files named `sport-env-lit-db-v*.html` and `index-old-*.html` are historical snapshots, not deployable replacements. Never copy a snapshot over `index.html` to deliver a feature.
- Keep features additive and isolated where practical. The follow workspace is in `follow-hub.js`/`.css`; local memos are in `memo.js`/`.css`.
- Preserve the `litdb-memo` IndexedDB database (version 1, `memos` and `files` stores) and existing personal storage keys. Never clear or reset user storage as a migration shortcut.
- Keep data refreshes separate from application source changes. Preserve current public access, full abstracts, multi-choice filters, all-result exports, independent following, local folders/notes, and lazy chart rendering.
- Before publishing, run `npm test`, inspect the diff, and bump the shell cache in `sw.js` when changing shell assets. Every new external application asset must be included in the service worker shell list.
- The regression workflow reports failures; it does not itself block GitHub Pages deployment. Do not describe it as a deployment gate unless repository deployment settings actually enforce it.

- The memo and following assets use versioned URLs to avoid mixing a new page with older cached modules. When changing these assets, keep their URL revisions in `index.html` and `sw.js` consistent, and update the full-page test inlining references.

- Figure study lives in `figure-hub.js` / `.css` and `figure-extract.js`. Preserve whole figures; never split A/B/C panels. Keep the vendored PDF.js worker, decoders and licenses together and lazy-load them; never add the 7 MB PDF runtime to the initial shell cache list.

- Figure study uses `litdb-figures` version 2 (`papers`, `figures`, `folders`). Upgrade additively; preserve PDF/image blobs, notes and manual paper titles. Figure backups v2 include folders and must still import v1 backups. Removing a folder moves its papers to unfiled without deleting their contents.
