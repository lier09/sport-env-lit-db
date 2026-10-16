# Working on the literature database

- Start from the latest `origin/main`; inspect and preserve newer changes before editing.
- `index.html` is the live application. Files named `sport-env-lit-db-v*.html` and `index-old-*.html` are historical snapshots, not deployable replacements. Never copy a snapshot over `index.html` to deliver a feature.
- Keep features additive and isolated where practical. The follow workspace is in `follow-hub.js`/`.css`; local memos are in `memo.js`/`.css`.
- Preserve the `litdb-memo` IndexedDB database (version 1, `memos` and `files` stores) and existing personal storage keys. Never clear or reset user storage as a migration shortcut.
- Keep data refreshes separate from application source changes. Preserve current public access, full abstracts, multi-choice filters, all-result exports, independent following, local folders/notes, and lazy chart rendering.
- Before publishing, run `npm test`, inspect the diff, and bump the shell cache in `sw.js` when changing shell assets. Every new external application asset must be included in the service worker shell list.
- The regression workflow reports failures; it does not itself block GitHub Pages deployment. Do not describe it as a deployment gate unless repository deployment settings actually enforce it.
