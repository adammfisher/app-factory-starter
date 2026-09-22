# Test plan — Tip Split

This run tests the factory, not the app. The sample `PRD.md` is what a product owner might hand over: well formed but not finished. It has one vague acceptance criterion, two open decisions and no taxonomy keys, so every part of the front door has something to do. The app itself is small: pure-logic maths that is easy to check, one screen, and two requirements that need on-device storage on iOS, Android and web.

The run budget is capped at $20 in `factory/config.json`. If the cap is reached the loop exits 2; run `npm run factory:build` again to continue.

## 0. Set up (5 minutes)
```bash
npm install
npm run typecheck && npm test      # seed feature F001 is green
npm run factory:selftest           # 51 checks, $0
npm run factory:guards             # ten deliberate breaks, each must turn a check red, $0
git init -b main && git add -A && git commit -m "init tip-split"
npm run factory:preflight          # one cheap real agent call; fix anything it flags
```

## 1. The front door
```bash
npm run factory:prd                # expect exactly one refusal: prd-acceptance-vague on R-006
```
Then run `/prd` in Claude Code. Expect questions about: the vague History criterion, the first-launch tip percent, and whether a saved bill has a note. Expect a proposed key for each of the six requirements. Expect to be shown a diff before anything is committed. Afterwards `SPEC.md` exists and `npm run factory:status` says `PRD -> SPEC: in step`.

To skip the interview: `cp factory/templates/PRD.sample-ready.md PRD.md && npm run factory:spec`.

## 2. Plan
```bash
npm run factory:plan
```
Expect a start line before each agent call, a heartbeat while it works, the proposed features with their requirement ids, the test files written, and `red first: confirmed` for each. Expect six to twelve features for six requirements; more than four for one requirement is refused and asked for again. Interrupt it if you like: running it again resumes without asking the planner twice.

**Then spend five minutes reading `spec/`.** This and the PRD are the two reviews in the whole run. If a test misreads a requirement, fix the PRD and regenerate, or fix the test and run `npm run factory:lock`.

## 3. Build, and walk away
```bash
npm run factory:build
```
Exit 0 means everything passed. Exit 4 means it finished with something blocked and a question waiting.

## 4. Answer, change, resume
Run `/questions`, then `npm run factory:plan` and `npm run factory:build`. To test change handling, edit one acceptance criterion in `PRD.md`, run `npm run factory:spec` and `npm run factory:plan`: only that requirement's features should be superseded and re-planned. Then `npm run factory:trace R-001` should walk from the requirement to a gate artifact with exit 0.

## 5. Devices and web
`npm run web` opens the app in a browser locally. For the cloud run: create a GitHub repo, `npx eas-cli@latest init`, link the repo in the EAS dashboard, push `main`. The `e2e` workflow builds both mobile platforms, runs Maestro, and publishes a web preview.

## Scorecard
| What to look for | Where | It proves |
|---|---|---|
| `/prd` asked only product questions and showed a diff before committing | the interview | The owner's role holds at the front door |
| `SPEC.md` regenerates byte-for-byte from the same PRD | `npm run factory:spec` twice, `git diff` | The spec is a projection, not a second source of truth |
| Every feature has a requirement id and key | `npm run factory:status` | The thread from PRD to code is intact |
| Every planned feature logs `red first: confirmed` | `factory/state/log.jsonl` | Tests existed and failed before any work started |
| A red gate is followed by a different stage, or green, next attempt | `gate` events | The failure reason reaches the fixer |
| A storage feature shows `(environment)` then phase `repair` | `gate` events | Failures are routed, not just retried |
| The `web` gate stage goes red at least once and recovers | console, `gate` events | Three platforms are enforced, not hoped for |
| Build-time questions are typed, have defaults, and the run kept going | `questions.json` | Nothing waits on you that does not have to |
| Features after a blocked one still ran | status | One wall does not stop the night |
| Product lines overtake machinery lines | last line of status | The harness stayed small |
| `npm run factory:trace R-00n` exits 0 for a built requirement | trace output | The thread from PRD to evidence is intact |
| Attempts, seconds and cost per feature | `agent` events | What an app actually costs to build |

## What I expect to go wrong first
1. **Storage on three platforms (R-005, R-006).** The obvious native storage packages need a Jest mock and may not run on web. This is where the repair rung and the `.web.ts` rule should earn their place. If it blocks instead, that is the first real finding.
2. **Turn limit.** A screen-heavy feature may hit `maxTurns: 40`. The gate still runs on whatever was written. Raise the limit only if `error_max_turns` repeats in the log.
3. **Over-specified tests.** If the oracle agent ties tests to layout, the builder will thrash. That is a fix in `factory/prompts/oracle.md`, not new machinery.

## Bring back
`factory/state/log.jsonl`, `features.json`, `questions.json`, `PRD.md`, and the output of `npm run factory:status`.
