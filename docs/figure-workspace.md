# Literature figure study workspace (pilot)

## Scope
Independent `#figures` route in classic, workbench and study layouts. Upload a PDF or add library metadata from a result card / reader. Preserve a complete Figure, including all A/B/C panels, axes and legends. Never split panels into individual records.

## Pipeline
- PDF.js 6.4.299 legacy browser build, vendored with licenses. Loaded on demand, with same-origin workers, fonts, character maps and decoders. PDF JavaScript evaluation is disabled. Official API reference: https://mozilla.github.io/pdf.js/examples/ .
- PDF text positions identify figure-caption anchors. Raster transforms and vector path bounds propose figure regions; aligned graphics can expand across columns even for short captions.
- Render the original PDF page and crop the complete proposed rectangle into PNG. Store original PDF, page number, normalized crop rectangle, full detected caption and method.
- All automatic results are **candidates**, not verified complete figures. Scan reports distinguish processed pages, failed pages, cancellation and candidate counts. A complete page scan does not prove complete figure coverage.
- Scan sequentially and save per page. Do not silently cap page count. Reruns retain existing figures and user notes. Manual cropping and confirmation provide correction paths.
- Scanned PDFs without text need manual cropping; no OCR or AI figure recognition is claimed in this pilot.

## Storage and recovery
New IndexedDB `litdb-figures`, version 1, stores `papers` and `figures`. Existing notebook/following storage is untouched. PDFs, PNGs, captions, understanding notes and self-reported mastery stay local.
Backups include originals and figures. Restore validates before writing, deduplicates and preserves existing notes/progress. Removed figures are soft-hidden and recoverable from the filter.

## Access
Only fetch an existing public PDF URL when requested. Use no third-party credentials. On cross-origin or access failure, open the legitimate source link and ask the user to download and upload the PDF. File size is limited to 80 MB. No bypass of publisher login or paid access.

## Design and QA ledger
- Header, main title, paper directory, central whole-figure viewer and right figure list follow the generated concept; no generated scientific illustration is shipped.
- Image viewing uses the actual extracted PNG. Thumbnails are whole-figure previews, not subpanels.
- Blue/white semantic tokens, outlined controls, legible source-page and candidate states. Responsive stacking on mobile; dark colors inherit existing theme.
- Crop dialog supports drag selection and numeric percentage bounds, with inline validation. Full-page selection is explicit, never presented as an automatically identified figure.
- Show/hide captions enables self-testing; notes and mastery are user assertions, not automated scientific judgments.
- Browser QA uses a two-page synthetic PDF containing a compound A+B figure and a vector figure, plus Mozilla's real 14-page PDF.js demonstration paper. These fixtures are not production library data.

## Pilot verification results
- The synthetic 2-page fixture produced two figure records. The first record includes both A and B panels; short caption handling was corrected during QA. Manual rectangle saving retains the original PDF.
- The real PDF.js demonstration paper processed 14/14 pages and returned 10 candidates. This is a pipeline/compatibility result, not a claim of complete figure recall or correct candidate classification.
- Fixed PDF.js v6 document disposal through its loading task; opening a second PDF and switching back to an earlier PDF page were exercised in the browser.
- Header/actions, paper directory, whole-image viewer, candidate badge, caption reveal and note controls match the concept. The center displays actual extracted PDF content, not the generated concept illustration.
- Responsive and dark-mode checks preserve image aspect ratios. Browser file upload, crop-save, note-save and mastery controls were exercised on a localhost test origin; no production papers or personal notes were seeded.
