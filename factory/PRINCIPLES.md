# Principles, and where each one lives

| Idea | In this repo |
|---|---|
| 1. Delivery is a loop, not a line | `factory/loop.mjs` `buildFeature()`: agent builds, `runGate()` checks, the failure record is written into the next prompt by `failureBlock()`. Upstream the same shape: `prd.mjs lint` refuses, `/prd` asks, the PRD is corrected. |
| 2. The checker sets the ceiling | The PRD must carry testable acceptance criteria before anything starts (`prd-acceptance-vague`, `prd-requirement-no-acceptance`) and be marked ready (`prd-not-approved`). Tests are written before the work (`writeOracle()`), proven red first, then hashed. Only the loop marks a feature `passing`, on a green gate, and the gate writes an artifact (`writeArtifact()`) that the commit cites. Agent output is schema-constrained JSON; its `summary` is never read for a decision. `factory/guards.mjs` proves every self-test check can fail. |
| 3. Knowledge lives in the record | `PRD.md` is authored truth. `SPEC.md` is a deterministic projection stamped with the PRD's hash (`specState()` refuses a stale one). `features.json`, `questions.json`, commit trailers, `factory/state/results/` and `factory/state/log.jsonl` hold the rest; `trace` walks them. Every agent call is a fresh session. Interview answers and build-time answers are written back into the PRD. |
| 4. Guardrails scale with what can't be undone | Code is reversible, so agents run free inside `app/` and `src/`. The worker cannot edit its rails, the PRD or the SPEC: `.claude/hooks/rails.mjs` blocks it, and `restoreRails()` plus the oracle hashes catch what the hook cannot see. Release cannot be undone, so `.eas/workflows/release.yml` has a `require-approval` job and `eas submit` is denied. The PRD has a section for exactly this. |
| 5. Problems go to the lowest level that can fix them | Continuation in `call()`, then the ladder in `buildFeature()`: retry, repair, re-plan, person. `classify()` routes environment failures straight to repair. A blocked feature never stops the features after it, and every block files a question. An unclear goal goes to the owner before any work, because nobody lower can fix it. The planner is held to a cap per requirement and cannot re-propose covered ones. |
| 6. Simple is a requirement | Four files run everything: `prd.mjs`, `loop.mjs`, `gate.mjs`, `agent.mjs`. SPEC generation uses no model. `npm run factory:status` prints machinery lines against product lines. `npm run factory:selftest` runs it all for $0. |

## The thread
Objective → requirement `R-002` → key `tipsplit.calculator.split` → feature `F003` → tests in `spec/` → commit `feat(F003)` → (later) events named by the same key. A changed requirement supersedes only the features that cite it.

## The owner's role
Own the PRD. Answer questions of four types: `fact`, `preference`, `credential`, `legal`. Review the PRD and the tests. Approve releases.

## The rule for changing the machinery
Add a mechanism only after a failure you observed, never in advance. Put the failing case into `factory/sim/fake-agent.mjs` and a check into `factory/selftest.mjs` first, watch it go red, then make it green. If machinery lines start to rival product lines, stop and delete something.
