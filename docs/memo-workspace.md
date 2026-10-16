# Research memo workspace

## Purpose
An independent, local research notebook linked to the literature library. Record evidence and uncertainty without inventing findings or quality scores.

## Navigation and layout
- Every layout links to `#memos`; legacy `#z-memo` resolves to the same workspace.
- Retain the library layout, filters and scroll position on return. Support browser back/forward.
- Desktop: compact header, introductory title, three columns (200 px directory, 310 px note list, remaining width reading/editor).
- Medium screens: directory above list/detail. Mobile: list then selected note, with an explicit jump to the list.
- Use existing semantic tokens: `--bg`, `--card`, `--ink`, `--muted`, `--accent`, `--accent-soft`, `--line`. Blue accents, quiet borders, readable text. No charts or research-quality scores.

## Content
- Categories: literature reading, research idea, experimental record, free note.
- Status: to organize, in progress, organized. Optional project, tags and linked library paper.
- Search title/body/project/tags. Filter category/project/status/pinned/archived/trash; stable updated-date sorting and pagination.
- Render complete note text with safe headings and line breaks. Show source metadata when an actual library record matches.
- Templates provide unanswered prompts for research question, design/sample, source-supported findings, limitations and next actions.
- Support existing attachments, new images/PDF, and RIS import with multiline abstracts.

## Data and reliability
- Keep IndexedDB `litdb-memo` version 1 and both original stores. New fields are optional on legacy rows.
- Resolve writes only when their transaction commits. Preserve editor content when storage fails.
- Archive and soft-delete are reversible. No automatic purge.
- JSON backup includes file content. Restore is additive, validates first, remaps record/file IDs and avoids repeat imports. No account credentials or API keys in backups.
- Warn before leaving unsaved edits; support keyboard save and visible save/error feedback.

## Acceptance
Test legacy data retention, source linking, filtering, pagination, create/edit/reload, reversible trash, multiline RIS and attachment backup restoration. Run the full application regression suite and inspect desktop/mobile and light/dark browser views before release.

## Visual verification ledger
- Header: retained back action, notebook identity, privacy notice, backup and primary creation action from the concept; added an import menu for existing RIS/backup workflows.
- Layout: three aligned columns with restrained borders. The desktop uses 220 / 350 / remaining pixels above 1400 px; narrow screens stack the directory and list with an explicit return-to-list control.
- Typography: inherited the site's Chinese sans-serif stack; 25 px main title, 21 px note title and 14 px / 1.85 reading text. Avoided bitmap text or new remote font dependencies.
- Content: clear heading/body blocks, real source metadata, project and tags follow the concept. The production database is never seeded with example research notes.
- Controls: consistent outlined SVG icons and blue primary actions. Added reversible trash, project/status selectors and backup import to support the requested research workflow.
- Theme: semantic colors verified in light and dark modes. No horizontal overflow at the 390 px mobile viewport.
- Evidence: local browser screenshots at desktop and mobile sizes; legacy data, attachment restoration and navigation checks are automated. Concept image remains a design reference, not a production asset.
