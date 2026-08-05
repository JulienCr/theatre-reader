# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Theatre Reader: a **local, single-user** tool to import a theatre play from PDF, edit it as Fountain, lay it out with configurable templates, read it on screen, and export to PDF. French UI. No accounts/DB — plays are stored as files under `data/`.

## Commands

```bash
pnpm install
pnpm setup:browser            # install Chromium for Playwright (export + ad-hoc e2e) — once
pnpm dev                      # server (:3001) + Vite web (:5173) via concurrently
pnpm build                    # web front → packages/web/dist, THEN build:ios (keeps the iOS bundle current)
pnpm ios                      # THE one to use: build + IPA + install on the connected iPhone
pnpm build:ios                # mobile-app Vite build + `cap sync ios` (regenerates ios/App/App/{public,capacitor.config.json,config.xml})
pnpm ipa:ios                  # build:ios + xcodebuild archive/export → IPA signed for 1 year (add `-- --no-web` to skip the front rebuild)
pnpm install:ios              # install that IPA on connected devices via `xcrun devicectl`
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
- **Range iteration**: everything that needs to walk the play by heading derives from `sceneRanges` in `scenes.ts` — `sceneMembers` (presence), `sceneVisibility` (the shared hide rule), `sceneSpans` (labels, for the study plan). Never re-walk headings by hand: that duplication is exactly what let out-of-scene content escape the "my scenes" filter.

### Learning plan (`study.ts` + `data/<slug>/study.json`)

A third full-screen mode (`AppMode = 'edit' | 'read' | 'study'`, source of truth in `web/src/sessionPrefs.ts`) that says what to rehearse today and whether the target date holds. Three things are non-obvious:

- **No calendar is ever stored.** `study.json` holds the config and per-node progress; the day's session is re-derived on every open by `planSession`. Falling behind redistributes the load on its own — a stored schedule would be wrong after the first missed day.
- **Progress is keyed by `nodeId`, never by portion.** A portion is a computed view whose size depends on `sessionMinutes`; keying by portion would mean that changing 25 → 30 min per session wipes the history. Keying by node also survives text edits and role changes. The known cost: `buildNodeIds` ids are `hash(content)#ordinal`, so inserting/removing an occurrence *before* an exact duplicate ("Ouais.") shifts the ordinal of the following ones and progress can drift by one occurrence — the same limitation notes have always had, deliberately not worked around.
- **The three tuning constants are calibrated, not guessed.** `COST_PER_LINE = 3.5` exists because word count alone is wrong on stage text: twenty "Ouais" weigh 40 words but cost a full session, since the work is in the cue, not the text. `forecast` divides by the **whole** session, not `budgetForSession` — stacking that 0.6 on top of the 20 % day reserve and the 0.8 threshold triples the same margin and reported BENJI (474 min of work, 550 available) as "late".
- Opening a portion in the reader navigates by **`data-nid`**, never `sceneId`: under "my scenes only" the reader filters the play, which shifts `h-<index>` while deliberately keeping content ids.
- **New text is never starved by its own reviews.** `planSession` caps fresh portions by `maxFresh` (the pace the target date requires) and by *nothing else*. Capping by session load too meant that once reviews filled 25 min, no new portion was ever scheduled again: measured on BENJI, the plan stopped at tirade 117 of 157 while still reporting "tight". An overlong session says so; a role you never finish learning does not.
- **`projectSchedule` replays the engine day by day** to produce the forecast calendar, assuming one passage in three needs a second go (`PROJECTION_HARD_EVERY`). Nothing is stored — it is recomputed on open, like everything else. It is also the only honest measure of real load: `forecast` reasons about new text alone and ignores what reviews will cost, so the calendar screen compares the projected average against the requested session length.
- **The `.ics` export is a snapshot of a forecast** (`ics.ts`, pure). A file rather than the Google API: no OAuth, no secret, no callback server. Times are written "floating" (no `Z`, no `TZID`) so 19:30 means 19:30 in whatever calendar imports it. Stable per-day UIDs make a re-export replace rather than duplicate.
- **"Portion" is an engine word and must never reach the screen.** Everything user-facing counts in tirades, and every boundary carries both its number and its text — a number alone means nothing to an actor, a quote alone doesn't say where you are.

### Import pipeline (`@theatre/import`)

`importPdf` chains: `extract.ts` (pdfjs-dist, reconstructs lines + **best-effort italic detection** via `page.commonObjs` font flags) → `heuristics.ts` (DISTRIBUTION → declared characters; `MAJUSCULES :` cues; italic/parenthetical → didascalies; collapses the source's repeated `ACTE II.` before each scene) → character resolution: **LLM** (`llm.ts`, Anthropic, when `ANTHROPIC_API_KEY` is set) else **fuzzy Levenshtein merge** (`characters.ts`) to fold OCR spelling variants (GIUSEPPPE/GISUEPPE → GIUSEPPE). Cues absent from the DISTRIBUTION are `flagged` for review.

### Audio cache (ElevenLabs TTS)

Clips live at `data/<slug>/audio/<key>.mp3`; the key is `sha1(model + voiceId + outputFormat + JSON(settings) + text)` (`server/src/storage.ts` `audioCacheKey`). The disk cache is the only dedup — there is no ElevenLabs "multi-text" API, so bulk features still make one `convert` call per uncached tirade; the win is skipping cache hits. Two non-obvious traps when adding audio features:
- **Text parity**: the reader/audio-player sends DOM-scraped text collapsed with `.replace(/\s+/g,' ').trim()` (`audio-player/src/index.ts` `collectTirades`), while core `speechText()` joins speech segments but does **not** collapse internal whitespace. **`speechTextForTts(node)` (`core/src/ast.ts`) is the single canonical normalizer** = `speechText(n).replace(/\s+/g,' ').trim()`; every AST-based cache warm/consume (online reader, bulk pre-generation, mobile export) must go through it, plus the same `model`/`settings` as `play.audio`, or it writes a different key → silent cache miss → wasted API calls. `collectTirades` scrapes the DOM so it stays hand-written — it's the parity anchor `speechTextForTts` must equal. Verify parity offline (no key/browser needed) by recomputing keys and checking them against on-disk `.mp3`s.
- **Format namespaces**: online playback + `/tts` + `/tts/batch` **and the reader/mobile HTML export** all default to `mp3_44100_128` (`DEFAULT_OUTPUT_FORMAT`), so one bulk pre-generation warms the cache for both online playback and the export. `outputFormat` is in the key, so the only way to break reuse is to override the export's `bitrate` (e.g. `mp3_44100_64`) — that mints a separate namespace the playback/bulk clips can't satisfy. The mobile export is cache-first: it embeds cached clips as base64 data URIs (offline rehearsal), synthesizes a missing clip only if a key is present, and silently skips missing clips when no key is set (partial export, never aborts).

`POST /api/plays/:slug/tts/batch` pre-warms the cache with 3 concurrent workers (quota-friendly), cache-first, returning `{ manifest: nodeId->{key,cached}, characters }` in one response (no streaming — drive progress client-side by chunking).

### How the iOS app finds the Mac (mDNS + ATS)

The phone reaches the Mac with **no address to type**, and the whole chain hinges on one thing: **a `.local` name, never an IP**.

- Fastify listens on `0.0.0.0` (`server/src/main.ts`). Any loopback `THEATRE_HOST` (`127.0.0.1`, `localhost`, `::1` — `isLoopbackHost`) closes it back **and** suppresses the mDNS announcement: advertising a name that resolves to the LAN IP while listening only on loopback is worse than not advertising, the phone connects and gets refused with nothing to explain why. The API has **no authentication** — anyone on the same Wi-Fi can read the plays and notes. Assumed trade-off, not an oversight.
- `server/src/discovery.ts` publishes `_theatre._tcp` with `host: 'theatre-reader.local'` via `bonjour-service`. The `host` option is the point: it names the **A records** the lib emits for every non-internal IPv4 interface, which is what makes the name resolvable from the phone. Verify with `dns-sd -B _theatre._tcp` then `dns-sd -G v4 theatre-reader.local`. Publishing failure is logged and swallowed — the server must still start.
- iOS blocks cleartext HTTP (**App Transport Security**) — this is why the app originally required Tailscale HTTPS. `NSAllowsLocalNetworking` in `ios/App/App/Info.plist` is the Apple-sanctioned exception, and it covers **Bonjour `.local` names and link-local only, not RFC1918 IPs** like `192.168.x.x`. Pointing the app at an IP would silently re-break it. `NSLocalNetworkUsageDescription` must be present too, or iOS 14+ never asks for the permission and denies every LAN call. These are plist keys, not entitlements: signing and provisioning are unaffected.
- `mobile-app/src/discovery.ts` probes `GET /api/health` and requires `body.app === 'theatre-reader'` — a bare 200 proves nothing (captive portals, other services on 3001). It probes through **`CapacitorHttp`** (native `URLSession`) rather than `fetch`, because a WebView request can fail *without ever triggering the local-network prompt*; once granted, ordinary `fetch` (clip downloads) works. Order is manual-address-first (Tailscale, works off-network and in HTTPS), then `http://theatre-reader.local:3001`.
- The LAN candidate hardcodes port 3001: a different `PORT` forces manual entry. `ADVERTISED_HOST` (server) and `LAN_BASE` (app) must stay in sync.

### Paged.js (pagination engine)

Used in two places, must stay behaviourally identical:
- **Server export** (`server/src/export.ts`): injects `paged.polyfill.js` in manual mode (`window.PagedConfig = { auto:false }`, then `PagedPolyfill.preview()`). pagedjs's `exports` map blocks subpath resolution, so the polyfill path is derived from the package root (`require.resolve('pagedjs')` + `dist/paged.polyfill.js`).
- **Web reader** (`web/src/components/Reader.tsx`): programmatic `Previewer.preview(html, [{ template: css }], container)`. **Inline CSS must be passed as an object `{ name: cssText }`** — a blob URL silently fails to apply `@page`, giving wrong pagination. The reader flattens Paged.js sheets via CSS into a continuous scroll with `— page N —` markers; `pagedjs` has no types (ambient decl in `web/src/pagedjs.d.ts`) and is lazy-loaded so it only ships when the reader opens.

### Web UI notes

- Mode is a segmented toggle `[Édition | Lecture]` (`mode: 'edit' | 'read'`). Reader is keyboard-first (`/` search, `n`/`p` matches, `g` page, `+`/`-`/`0` zoom, `f` fullscreen, `?` help, Esc).
- **Command palette** (`⌘K`/`Ctrl+K`, `CommandPalette.tsx`): its key handler calls `e.stopPropagation()` so palette keys don't leak to the Reader's window-level shortcuts (notably Esc).
- **Fullscreen** = browser Fullscreen API on `documentElement`; `.app.fullscreen` CSS hides all toolbars for immersive reading (navigation stays via keyboard + palette).

## Environment & tooling

- `ANTHROPIC_API_KEY` — enables LLM character normalization at import (default model `claude-sonnet-4-6`, override `THEATRE_LLM_MODEL`). `THEATRE_DATA_DIR` overrides `./data`; `PORT` overrides `3001`; `THEATRE_HOST` overrides the listen address (see below).
- pnpm 10 blocks build scripts; `onlyBuiltDependencies` in `pnpm-workspace.yaml` is the allowlist (currently `core-js`, `es5-ext`, `esbuild`). **Those entries are approved by hand via `pnpm approve-builds` — never revert them**: a from-scratch reinstall can rewrite that file, and it looks exactly like pnpm having widened the list on its own. Playwright browsers are NOT auto-downloaded — run `pnpm setup:browser`.
- **Node ≥ 22** (`engines.node`), imposed by `@capacitor/cli` — the `ios` / `cap:sync` scripts refuse to run below that.
- **iOS signing — team `U3P93WXUHR` ("Compagnie Avolo", *paid* Apple Developer Program)**. `DEVELOPMENT_TEAM` is committed in the four build configs of `packages/mobile-app/ios/App/App.xcodeproj/project.pbxproj` (a Team ID is not a secret; committing it avoids re-picking the team in Signing & Capabilities after every clone). This is what makes a build last **1 year** instead of 7 days — the free "personal team" that Xcode offers by default issues profiles with `TimeToLive = 7`. Everything else is automatic (`CODE_SIGN_STYLE = Automatic`, no `PROVISIONING_PROFILE_SPECIFIER`, no `CODE_SIGN_IDENTITY`); `xcodebuild -allowProvisioningUpdates` creates and renews the profile. Two consequences: the target device must be **registered on that team** to appear in the profile, and switching teams changes `application-identifier`, so iOS treats it as a different app — **the previously installed build must be deleted first, which wipes its container** (locally stored plays + offline audio). `App/ExportOptions.plist` exports with `method = debugging` (ex-`development`), **not** `release-testing` (ex-`ad-hoc`): measured on 2026-08-05, an ad-hoc export yields a profile expiring with the Apple Distribution certificate (30/01/2027, ~6 months) while a development profile is freshly issued for a full 365 days — the only trade-off is `get-task-allow = true`. That file and the shared scheme `App.xcscheme` exist only to make `xcodebuild archive`/`-exportArchive` work headlessly; if you ever add an entitlement, also set `CODE_SIGN_ENTITLEMENTS` and verify with `codesign -d --entitlements -` that it really landed in the binary.
- **`.npmrc` hoists `@capacitor/*` to the root `node_modules`** on purpose: `ios/App/CapApp-SPM/Package.swift` (regenerated by `cap sync`, never edit it by hand) points at `<root>/node_modules/@capacitor/filesystem` with a hardcoded relative path. Without the hoist, pnpm's default layout only links the plugin under `packages/mobile-app/node_modules` and the iOS build breaks on a fresh clone.
- `textes/` (source PDFs, third-party copyright) and `data/` are gitignored **in this repo**; never commit them here. **`data/` has its own independent git repo** (nested, for versioning the plays themselves — Fountain + meta + notes + the ElevenLabs audio cache, which is costly to regenerate). Backups matching `*.bak-*` are ignored there.
- **Updating a play from an author's revised PDF**: use `scripts/update-text/` (see its README). It diffs the red-stripped PDF text against `play.fountain` to find every change — it does not rely on the author's red-dash/bold markers.
