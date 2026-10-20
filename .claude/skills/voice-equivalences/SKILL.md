---
name: voice-equivalences
description: Map of how @theatre/voice-match decides two words, or a missing/extra word, count as the same during voice rehearsal. Use before adding or changing an equivalence (dictation confuses X and Y, "ignore this word", "accept this spelling"), or when a correctly spoken line is refused or a wrong one accepted. Triggers on "équivalence", "la dictée confond", "l'iPhone comprend", "ignore ce mot", "mode souple/strict", "voice-match".
---

# Voice-match equivalences: where each kind lives

Everything is in `packages/voice-match/src/`, pure, no DOM. Tests: `evaluate.test.ts`
(one `verdict(expected, heard, tolerance?)` helper, add cases next to the siblings).
Run: `pnpm vitest run packages/voice-match && pnpm --filter @theatre/voice-match typecheck`.

## Pick the mechanism by the symptom

| The need | Where | Applies to |
|---|---|---|
| Two **different words** are interchangeable (`on`/`en`, `ce`/`cette`, `tant`/`tente`) | `variants.ts` → add a class to `CLASSES` | soft + strict |
| Two words **sound the same** but are spelled differently | nothing to do: `phonetic.ts` already groups them. Fix the rules there only if a real homophone is missed | soft + strict |
| A word **split in two / two glued** by dictation (`environ`/`en virant`) | `variants.ts` too, using the **joined key** (the two keys concatenated, accents folded: `envirant`) | soft + strict |
| `n'a` ≈ `a` (elided *ne*) | `sameElidedNe` in `align.ts` | soft + strict |
| Verb plural `-ent` ≈ singular (`dégagent`/`dégage`) | `silentEnt` in `align.ts` (`phonetic.ts` reads the silent `-ent` as a nasal, and a general fix there would merge `comment`/`comme`, `sent`/`se`) | soft + strict |
| An equivalence **only in soft mode** (a register swap such as `ouais`/`oui`) | `SOFT_CLASSES` in `variants.ts`, reached through `AlignOptions.soft` ← `Profile.softVariants` | soft |
| A word **split/glued** by dictation with a confused nasal (`envoie` / `on voit`: `A`≠`O`) | `sameLooseSound` in `align.ts`, used by `mergeCost`/`splitCost` only. NOT 1-for-1: it would merge `dent`/`dont` | soft + strict |
| A word may be **missing** or **extra** and that is fine | `leniency.ts` (`forgivenDel` / `forgivenIns`) | see below |
| A missing word must **fail** or **block** the line | `weight.ts` (`SENSE` set, `blocks`, `weightOf`) | — |
| Hesitations (`euh`…) ignored when extra | `FILLERS` in `normalize.ts` (profile `ignoreFillers`, soft only) | soft |
| Thresholds, strict vs soft | `PROFILES` in `evaluate.ts` (add a boolean flag there for a new soft-only rule, like `forgiveNe`) | — |

## Current rules

- **`variants.ts`**: `ce/cet/cette/ces`, `environ/envirant`, `plutot/plustot`, `tant/tente`, `on/en`, `monsieur/mr/m`, `madame/mme`, `mademoiselle/mlle`, and the contractions `t'as/tu as`, `t'es/tu es`, `j'suis/je suis/chuis/chui` (joined keys `tuas`, `tues`, `jesuis`).
  Soft only (`SOFT_CLASSES`): `ouais/oui`, `ben/bah`.
  The table stays SHORT: each entry makes two different texts equal. Never a verb, noun or negation.
  Consulted by `similarity()` only, never by the comparison key (that would leak into weights and phonetics). Returns `HOMOPHONE_SIM` (0.95), which passes every threshold, strict included.
- **`leniency.ts`**:
  - `ne` missing: free in **soft only** (`forgiveNe`). Strict still counts it.
  - `il` before `y a` / `ya` / `faut`: free to drop or add, both modes. So `il y a` = `y a` = `ya` = `il ya`, `il faut` = `faut` (`ya` ≡ `y a` already comes from the merge/split in `align.ts`).
  - Repeated word (`très très`): free if at least one copy was matched. One said for two expected, or two heard for one expected. Both modes.
- **Display**: a forgiven `del` is marked `ok` in `words`, so the screen never shows it as missing.

## Traps

- **A repeat must be free in the alignment too, not only in the score.** `align.ts` has `delCost`/`insCost` (0 for a word repeating its neighbour). Without them the free start (`maxSkip`) wins the tie and aligns the first word with the duplicate: `c'est très` vs `c'est très très` failed that way. If you add a forgiven case that the aligner can mistake for a substitution, give it a zero cost there as well, and keep the traceback in step (same cost function in the DP and in the backtrack).
- **`ç` is `ss` for the phonetic key only** (`splitWords` in `normalize.ts`): `fold` strips the cedilla, which used to leave a hard `c` (`ça` read /ka/, `sa` /sa/).
- **`variants.ts` keys are folded keys**, not raw text: no accents, lowercase, apostrophe straight (`plutot`, not `plutôt`).
- **Forgiveness is decided after alignment** from the op list, using the sets of matched indices (`matchedE`/`matchedH` in `scoreOps`). `evaluatePrefix` shares `scoreOps`, so a change there reaches the mid-tirade pause judgment too.
- Check both directions (expected→heard and heard→expected) and both tolerances in the test: that is how every existing equivalence is covered.
- A new equivalence is a deliberate exception to the "stay faithful to the text" goal. Say in the comment WHY (what the dictation does), in ≤ 3 lines.
