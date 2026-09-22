# App factory starter

One repo per app. Each repo is an Expo app (iOS, Android and web from one code base) plus a small loop that builds it with Claude Code, checks the work by machine, recovers from failures on its own, and brings you only the questions a person has to answer.

Clone it, or mark it a GitHub template, to start every new app. It ships with a sample PRD for a small app called Tip Split so you can run the whole flow straight away.

## The flow

| Step | You run | What happens |
|---|---|---|
| 1. PRD | write `PRD.md`, or hand over notes | The owner's document, in a fixed template: objective, users, outcome metrics, requirements with acceptance criteria, rules, what can't be undone. |
| 2. Check | `npm run factory:prd` | A deterministic lint. Named refusals for a missing section, a requirement with no criteria, a vague criterion, a metric with no baseline, a bad key, a leftover placeholder. No model involved. |
| 3. Interview | `/prd` in Claude Code | Claude asks about every refusal, every ambiguity and every open decision. Product questions only. Answers are written into the PRD, keys are proposed for each requirement, you approve the diff, and it is committed. |
| 4. Spec | `npm run factory:spec` | `SPEC.md` is generated from the PRD and stamped with the PRD's hash. It is never edited by hand. If the PRD changes, the loop refuses to run until the spec is regenerated. |
| 5. Plan | `npm run factory:plan` | An agent splits requirements into features. For each, a second agent writes the acceptance tests first; the loop proves them failing and locks them by hash. Resumable. A changed requirement re-derives only its own features. |
| 6. Build | `npm run factory:build` | One fresh agent per feature. The gate runs typecheck, that feature's tests, every test, then a web export. Green: the loop marks it passing and commits. Red: the failure goes into the next attempt. |
| 7. Devices and web | push to `main` | EAS builds iOS and Android in the cloud, runs every Maestro flow on a simulator and an emulator, and publishes a web preview. No local Xcode or Android setup. |
| 8. Release | `npm run release:cloud` | Production builds, then a `require-approval` step that waits for you, then store submission and the production web deploy. |

`npm run factory:status` shows where things stand at any time. `/questions` walks you through anything waiting on you and writes your answers back into the PRD.

Both long-running commands say what they are doing: a line before each agent call, a heartbeat every 30 seconds, elapsed time and cost after it, the features the planner proposed, the test files written, and one line per gate stage. For tool-by-tool detail set `"progress": "stream"` in `factory/config.json` (see First run).

## When a feature fails

The loop climbs a ladder and stops at the first rung that works:

0. **Continue.** A session that ran out of turns is relaunched from the working tree, at most `budget.maxContinuations` times. Not an attempt.
1. **Retry.** The same job again, with the failed check and its output in the prompt (twice).
2. **Repair.** A different brief: the cause may be tooling, configuration, a dependency, or a module that does not run on one platform. Environment failures skip straight here.
3. **Re-plan.** Split the feature into smaller ones that still cover every original criterion, or block it.
4. **You.** A blocked feature files one typed question with a default. The loop moves on to the next feature without waiting.

Exit codes: `0` done · `1` plan left a requirement uncovered · `2` budget reached (plan or build; run it again) · `3` trace found a gap · `4` finished with blocked features · `64` refused to start.

Every block files a question, including a feature whose tests could not be written.

## Your role

You own the PRD. You answer four kinds of question: a fact, a preference, a credential, a legal position. The agent's output schema has no slot for a coding question. Every build-time question arrives with the default the factory is already using, so nothing stalls while you are away. Three things do wait for you: the PRD interview (an unclear goal is the most expensive defect there is), a question marked `blocking`, and release approval.

You review two things: the PRD, and the tests in `spec/` after planning. Everything between them is generated.

## Evidence and the thread

Every gate writes `factory/state/results/<runId>/result.json`: one step per stage, the exit, and what failed. That artifact is the only evidence; the log and the console describe it. A passing commit carries trailers (`Feature:`, `Requirement:`, `Key:`, `Gate: <runId>`), so `npm run factory:trace R-002` walks requirement → feature → tests → commit → gate artifact and prints a gap where a link is missing, never a guess. Artifacts are not committed; on another machine trace reports that as a gap.

`npm run factory:status` prints the inbox first, then a reading per requirement (`met`, `unmet`, `unverifiable`) read from the ledger, then the features.

## Light now, able to scale

Three seams differ between a one-person app and a multi-repo estate. Only the left column is built.

| Seam | Here | At scale |
|---|---|---|
| Where the capability tree lives | Keys such as `tipsplit.history.save`, written in the PRD | A canonical tree in a context repo, validated by a compiler |
| What the pin is | The PRD's content hash, stamped into `SPEC.md` | A registry snapshot |
| Fan-out | One PRD, one spec, one repo | One PRD, impact resolution, a spec slice per repo |

Everything else is the same at both sizes: the template, requirement ids, refusal codes, the spec stamp, the question types. Keys already ride on every feature in `features.json`, so per-feature analytics and cost reporting can be added later without touching the PRD format.

## First run

```bash
npm install                     # generates the lockfile on your machine
npm run typecheck && npm test   # the seed feature F001 is green
npm run factory:selftest        # the front door and the whole loop against a fake agent, $0
npm run factory:guards          # breaks the loop ten ways and proves the self-test catches each, $0, about a minute
git init -b main && git add -A && git commit -m "init from app factory starter"
npm run factory:preflight       # one cheap real agent call: flags, permissions, rails hook
npm run factory:prd             # the sample PRD has one deliberate refusal
```
Then `/prd` in Claude Code. To skip the interview and go straight to planning, copy `factory/templates/PRD.sample-ready.md` over `PRD.md` and run `npm run factory:spec`.

Things that could not be verified outside your machine (`factory:preflight` checks the first three):

1. **Claude Code flags.** `--permission-prompts none` needs Claude Code 2.1.259 or later. If yours rejects it, remove it from `agent.extraFlags` in `factory/config.json`.
2. **The hook sees the phase.** The loop sets `FACTORY_PHASE` for the agent; `.claude/hooks/rails.mjs` reads it. If it does not arrive, the hash check in the gate still protects the tests.
3. **Permissions.** Agents run in `acceptEdits` with the allowlist in `.claude/settings.json`. Inside a container you can use `bypassPermissions` instead. Not on your laptop.
4. **Stream mode.** `"progress": "stream"` switches to `--output-format stream-json`. The docs confirm the stream ends with a `result` message; whether it carries `structured_output` is unconfirmed. Run `npm run factory:preflight` with it set before relying on it.
5. **EAS.** `flow_path: '.maestro'` passes a directory (list files if EAS wants them); the `maestro` job type is alpha; the `deploy` job is assumed to export the web build itself.

## What is verified, and what is not

Verified here: dependencies install; `tsc` and Jest pass; the web build exports; the real four-stage gate goes red for a broken screen, a type error, a tampered test and an import that cannot bundle for web; the self-test's 51 checks pass; all ten guard mutations fire.

Found by the first real run and fixed in this version: a second `plan` accepted proposals for requirements already covered (duplicates); the plan prompt said "smallest features" and got one feature per criterion; `plan` had no budget check; any edit to a requirement, including a re-tag or a priority change, superseded its features (the hash now covers only the statement and the criteria, and a re-tag updates the key in place). Cost and attempts per feature are still unknown.

Not built yet, on purpose: device and web-preview results do not feed back into the loop; no visual judge; no building blocks (storage, analytics, crash reporting, paywall). Build those through the loop, in a PRD of their own.

## Tuning

Everything adjustable is in `factory/config.json`: gate commands, ladder sizes, the per-run budget, continuations, `plan.maxFeaturesPerRequirement` (default 4), the agent command, progress mode, and a model per phase (for example `"models": { "plan": "opus", "oracle": "opus", "build": "sonnet", "repair": "opus", "replan": "opus" }`). Empty means your Claude Code default.

If you edit a test or flow yourself, run `npm run factory:lock`. If you change anything in `factory/` or `.claude/hooks/`, run `npm run factory:selftest` and `npm run factory:guards`, and commit before the next build: the loop refuses to start with uncommitted machinery, because it restores those paths after every agent run.

`factory/PRINCIPLES.md` maps each of the six ideas to the code that implements it.
