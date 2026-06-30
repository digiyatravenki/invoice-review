# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, dependency-free (no build step, no package manager) front-end for reviewing invoices that have been extracted by an upstream OCR/LLM pipeline. Two pages (`index.html` overview, `review.html` detail) share a single script, `app.js`, and a single stylesheet, `styles.css`. Third-party libs (PDF.js, Tabler icons) load from CDNs at runtime.

## Running / developing

There is no build, lint, or test tooling. Open the HTML directly, or serve the folder over HTTP so `fetch` and PDF.js work without file:// restrictions:

```
python3 -m http.server 8000   # then visit http://localhost:8000/index.html
```

Manual smoke-testing is the only "test." `window.InvoiceApp` (bottom of `app.js`) exposes the key functions for poking from the browser console.

## Architecture

**Single-script, two-page dispatch.** `app.js` is one IIFE. The bootstrap at the bottom reads `document.body.dataset.page` (`"overview"` or `"review"`, set via the `data-page` attribute on `<body>`) and calls `initOverview()` or `initReview()`. Anything shared (formatters, `loadLatestInvoice`, toasts) lives between the two page sections.

**One real backend call.** `loadLatestInvoice()` POSTs to an n8n webhook (`digiyatravenki.app.n8n.cloud/.../latest-invoice`) and returns `{ pdf_url, validations, extracted }` for the single most-recently-processed invoice. There is no per-invoice fetch and no id in any URL — both the overview row and the review page always represent *the latest* invoice, so navigation is just `window.location.href = "review.html"`.

**Mock fallback.** When the webhook is unreachable, every loader falls back to `mock-data.js` (`window.buildMockReview()` / `window.MOCK_INVOICES`), which mirrors the live payload shape exactly so the UI is demoable as pure static hosting. When changing the payload contract, update `mock-data.js` in lockstep.

**Payload shapes (important, easy to get wrong):**
- `extracted` maps a field label → an array of `{ match, confidence, typed_value }`; only the first element is used (`getMatch`). `extracted.Table` is the exception: an array of row objects whose cells are bare `{ match, confidence }` (not wrapped in an array).
- `validations` is a flat object of `rule01_*` … `rule10_*` → boolean. `true` = pass, `false` = fail, **missing key = "not evaluated"** (the three-way distinction matters in `renderValidations`).
- `normalizeReview()` converts the API shape into `{ matches, validations, name, pdf_url }` for the renderers; derives a filename from `pdf_url` when `name` is absent.

**Field layout is config-driven.** `FIELD_SECTIONS` (sectioned top-level fields) and `VALIDATION_RULES` (ordered `[payloadKey, humanLabel]`) drive what renders and in what order. Add/rename fields or rules by editing these arrays — keys must match the payload's labels exactly (e.g. `"Invoice Number"`, `"Vendor VAT Number"`).

**Editing is local-only and visual-only.** Save / Accept / Reject make **no backend calls**. Inline edits flow through `onFieldInput` into `reviewState` (`extracted` = original values+confidence, `edited` = diffs, `dirty` = unsaved flag). Editing a field swaps its confidence badge for an "Edited" indicator; `beforeunload` warns on unsaved changes. Overview "Delete" (context menu) only removes the DOM row.

**PDF preview is lazy.** PDF.js and the document binary are not fetched until the user clicks the `#pdf-placeholder`; `setupPdfLazyLoad` → `renderPDF` handles load, paging, devicePixelRatio scaling, and resize re-fit. Failures degrade to an "Open PDF in new tab" link rather than throwing.

## Conventions

- Rendering is string-concatenation `innerHTML`; all dynamic values must pass through `escapeHtml()` (there is no framework escaping). Follow this when adding markup.
- Vanilla ES5-ish style throughout (`function`, `var`-free but no arrow functions in the render helpers, `Array.prototype.forEach.call` over NodeLists). Match it.
