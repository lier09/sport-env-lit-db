# Homepage rehearsal — 2026-11-05

Stageshow reference: `benjitaylor/skills`, `stageshow/examples/bento`.
Applied its focal-card hierarchy, spacing, surface contrast and restrained hover feedback to the existing plain-JavaScript application. No mock UI runtime or React dependency was added.

The classic homepage retains its original Everest background, typography, colors and statistics. Four functional workspace entries appear below the original header. Memos are the leading card; following, whole-figure study and Meta candidate tracking are secondary. Existing alternate layouts, research rings, search, data and personal storage remain unchanged.

Verification:
- Full `npm test` passed, including startup, search/filter/export, memo, following, figure, Meta and pending-review workflows.
- Headless Chrome with isolated synthetic records opened all four new workspace links without page errors.
- Desktop 1440 px and mobile 390 px screenshots inspected in light and dark themes; no horizontal overflow.
- Reduced-motion mode removes the new hover transition. No autoplay or timeline animation is introduced.
- Static visual rehearsal screenshots use sample statistics, not live-release evidence; the functional browser run uses one synthetic record. No account or real personal data was modified.
- Service-worker shell advanced to 102 and includes the new stylesheet.

Scope: frontend presentation only. This does not certify ingestion quality, backend scheduling, or the current publication count.
