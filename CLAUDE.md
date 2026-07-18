# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Theatre Reader: a **local, single-user** tool to import a theatre play from PDF, edit it as Fountain, lay it out with configurable templates, read it on screen, and export to PDF. French UI. No accounts/DB — plays are stored as files under `data/`.

## Commands

```bash
pnpm install
pnpm setup:browser            # install Chromium for Playwright (export + ad-hoc e2e) — once
pnpm dev                      # server (:3001) + Vite web (:5173) via concurrently
pnpm build                    # build the web front to packages/web/dist
pnpm start                    # run only the server (serves packages/web/dist if present)
pnpm test                     # all vitest unit tests (core + import)
pnpm typecheck                # tsc --noEmit in every package

pnpm vitest run packages/core/src/render.test.ts   # one test file
pnpm vitest run -t "buildToc"                       # tests matching a name
pnpm --filter @theatre/web typecheck               # typecheck one package
```

- **Dev URL is http://localhost:5173** — Vite binds to `localhost` (IPv6 `::1`), NOT `127.0.0.1` (curl/Playwright against `127.0.0.1:5173` will be refused). The server at `:3001` is reachable on `127.0.0.1` and also serves the built front when `dist/` exists, which is the convenient target for headless Playwright checks (`http://127.0.0.1:3001`).
- There are **no web unit tests**; the front is verified with throwaway Playwright scripts. Put them under `packages/server/` (so `playwright` resolves) and delete after — do not commit them.

## Architecture

pnpm monorepo, TypeScript everywhere, **"internal packages" pattern**: each package's `exports` points at `./src/index.ts` directly (no build step). `tsx` runs the server from source; Vite bundles `@theatre/core`/`@theatre/import` source into the web build. Type safety comes from per-package `pnpm typecheck`, not from a build.

| Package | Role |
|---|---|
| `@theatre/core` | Data model (AST), Fountain↔AST, template model, HTML/CSS rendering. **No I/O.** |
| `@theatre/import` | PDF → Fountain pipeline (pdfjs extract → heuristics → character resolution). |
| `@theatre/server` | Fastify API (`/import`, `/plays`, `/export`) + Playwright PDF export + file storage. |
| `@theatre/web` | React/Vite UI: edit workspace + reader mode + command palette. |

### The rendering contract (most important invariant)

`@theatre/core` is the **single source of rendering**. Web preview, the reader, and the server PDF export all render the same play through `renderBody` / `renderCSS` / `renderDocument`. To change how anything looks, change `core/src/render.ts` — never re-implement rendering in web or server. Because export (server) and reader (web) both feed the identical `renderBody`+`renderCSS` into Paged.js, **on-screen page numbers match the exported PDF exactly**.

### Source of truth & persistence

- **Fountain text** (`data/<slug>/play.fountain`) is the editable source of truth for *structure*.
- **`data/<slug>/meta.json`** = `{ name, characters, template }`. Character **aliases/descriptions** and the **template** live here because Fountain can't carry them.
- On load, `parseFountain(fountain, meta.characters)` re-binds each cue line to a character via its aliases (so renaming a character keeps working as long as the original spelling stays in `aliases`). The Fountain text is saved verbatim from the editor; it is only re-serialized once, at import.

### Key conventions in core

- **Inline didascalie**: any `(...)` inside dialogue is tagged as a `didascalie` segment (styleable separately) while staying valid Fountain. See `splitInlineSegments` in `fountain.ts`.
- **Heading ids**: act/scene headings get `id="h-<nodeIndex>"`. `buildToc(play, template)` is the single source that produces these ids + labels (incl. the act-prefix and act-suppression rules for `showAct`); `renderBody`, the TOC, and the Reader nav all rely on it. Keep them consistent through `buildToc`.
- **Highlights** are rendered as inline `style="background-color:…"` (dynamic per character), not CSS classes. `template.highlights` is the only source; `Character` has no rendered color.
- **Template option back-compat**: newer boolean template fields are read defensively (`x !== false` for default-on, `x === false` to disable) so older `meta.json` lacking the field still renders correctly. Follow this pattern when adding template flags, and add the field to `actorReadingTemplate` in `template.ts`.

### Import pipeline (`@theatre/import`)

`importPdf` chains: `extract.ts` (pdfjs-dist, reconstructs lines + **best-effort italic detection** via `page.commonObjs` font flags) → `heuristics.ts` (DISTRIBUTION → declared characters; `MAJUSCULES :` cues; italic/parenthetical → didascalies; collapses the source's repeated `ACTE II.` before each scene) → character resolution: **LLM** (`llm.ts`, Anthropic, when `ANTHROPIC_API_KEY` is set) else **fuzzy Levenshtein merge** (`characters.ts`) to fold OCR spelling variants (GIUSEPPPE/GISUEPPE → GIUSEPPE). Cues absent from the DISTRIBUTION are `flagged` for review.

### Audio cache (ElevenLabs TTS)

Clips live at `data/<slug>/audio/<key>.mp3`; the key is `sha1(model + voiceId + outputFormat + JSON(settings) + text)` (`server/src/storage.ts` `audioCacheKey`). The disk cache is the only dedup — there is no ElevenLabs "multi-text" API, so bulk features still make one `convert` call per uncached tirade; the win is skipping cache hits. Two non-obvious traps when adding audio features:
- **Text parity**: the reader/audio-player sends DOM-scraped text collapsed with `.replace(/\s+/g,' ').trim()` (`audio-player/src/index.ts` `collectTirades`), while core `speechText()` joins speech segments but does **not** collapse internal whitespace. **`speechTextForTts(node)` (`core/src/ast.ts`) is the single canonical normalizer** = `speechText(n).replace(/\s+/g,' ').trim()`; every AST-based cache warm/consume (online reader, bulk pre-generation, mobile export) must go through it, plus the same `model`/`settings` as `play.audio`, or it writes a different key → silent cache miss → wasted API calls. `collectTirades` scrapes the DOM so it stays hand-written — it's the parity anchor `speechTextForTts` must equal. Verify parity offline (no key/browser needed) by recomputing keys and checking them against on-disk `.mp3`s.
- **Format namespaces**: online playback + `/tts` + `/tts/batch` **and the reader/mobile HTML export** all default to `mp3_44100_128` (`DEFAULT_OUTPUT_FORMAT`), so one bulk pre-generation warms the cache for both online playback and the export. `outputFormat` is in the key, so the only way to break reuse is to override the export's `bitrate` (e.g. `mp3_44100_64`) — that mints a separate namespace the playback/bulk clips can't satisfy. The mobile export is cache-first: it embeds cached clips as base64 data URIs (offline rehearsal), synthesizes a missing clip only if a key is present, and silently skips missing clips when no key is set (partial export, never aborts).

`POST /api/plays/:slug/tts/batch` pre-warms the cache with 3 concurrent workers (quota-friendly), cache-first, returning `{ manifest: nodeId->{key,cached}, characters }` in one response (no streaming — drive progress client-side by chunking).

### Paged.js (pagination engine)

Used in two places, must stay behaviourally identical:
- **Server export** (`server/src/export.ts`): injects `paged.polyfill.js` in manual mode (`window.PagedConfig = { auto:false }`, then `PagedPolyfill.preview()`). pagedjs's `exports` map blocks subpath resolution, so the polyfill path is derived from the package root (`require.resolve('pagedjs')` + `dist/paged.polyfill.js`).
- **Web reader** (`web/src/components/Reader.tsx`): programmatic `Previewer.preview(html, [{ template: css }], container)`. **Inline CSS must be passed as an object `{ name: cssText }`** — a blob URL silently fails to apply `@page`, giving wrong pagination. The reader flattens Paged.js sheets via CSS into a continuous scroll with `— page N —` markers; `pagedjs` has no types (ambient decl in `web/src/pagedjs.d.ts`) and is lazy-loaded so it only ships when the reader opens.

### Web UI notes

- Mode is a segmented toggle `[Édition | Lecture]` (`mode: 'edit' | 'read'`). Reader is keyboard-first (`/` search, `n`/`p` matches, `g` page, `+`/`-`/`0` zoom, `f` fullscreen, `?` help, Esc).
- **Command palette** (`⌘K`/`Ctrl+K`, `CommandPalette.tsx`): its key handler calls `e.stopPropagation()` so palette keys don't leak to the Reader's window-level shortcuts (notably Esc).
- **Fullscreen** = browser Fullscreen API on `documentElement`; `.app.fullscreen` CSS hides all toolbars for immersive reading (navigation stays via keyboard + palette).

## Environment & tooling

- `ANTHROPIC_API_KEY` — enables LLM character normalization at import (default model `claude-sonnet-4-6`, override `THEATRE_LLM_MODEL`). `THEATRE_DATA_DIR` overrides `./data`; `PORT` overrides `3001`.
- pnpm 10 blocks build scripts: only `esbuild` is allowlisted in `pnpm-workspace.yaml` (`onlyBuiltDependencies`). Playwright browsers are NOT auto-downloaded — run `pnpm setup:browser`.
- `textes/` (source PDFs, third-party copyright) and `data/` are gitignored **in this repo**; never commit them here. **`data/` has its own independent git repo** (nested, for versioning the plays themselves — Fountain + meta + notes + the ElevenLabs audio cache, which is costly to regenerate). Backups matching `*.bak-*` are ignored there.
- **Updating a play from an author's revised PDF**: use `scripts/update-text/` (see its README). It diffs the red-stripped PDF text against `play.fountain` to find every change — it does not rely on the author's red-dash/bold markers.
