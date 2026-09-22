---
description: Interview the owner until PRD.md is complete, tag it, and generate SPEC.md
---
PRD.md is the owner's document and the single source of truth. Your job is to get it to the point where `npm run factory:spec` succeeds, by asking, never by guessing.

1. If PRD.md does not exist, copy factory/templates/PRD.template.md to PRD.md. If I point you at notes, documents or a transcript, draft the PRD from them in the template's exact line shapes, and tell me what you could not find.
2. Run `node factory/prd.mjs lint --json`. For each refusal, ask me what is needed to fix it, one question at a time, in plain language. Product questions only: what, who, how much, by when, what happens when it goes wrong, what must never happen. Never ask me a technical question. Decide those yourself.
3. Read the whole PRD for anything a test could not settle: two criteria that contradict each other, a behaviour with no stated error case, a number with no unit or limit, a metric nothing measures. Ask about each. If two statements conflict, show me both and let me choose. Never resolve a conflict silently.
4. For every item under "Not decided yet", ask me. If I decide, remove the item, update the requirement it affects, and add a dated line under "Decisions": `- YYYY-MM-DD · R-00N · what was decided (owner)`. If I would rather not decide now, propose a default; when I accept it, move it to "Assumptions" ending with `(default, unconfirmed)`. "Not decided yet" must end as `- None.`
5. Propose a `- Key: domain.capability.feature` for every requirement that lacks one, lower case, reusing keys that already exist in the PRD where a requirement extends the same feature. Show me the list and let me change it before you write it.
6. Set `- Status: ready`, raise `- Version:`, and if the product name changed, set name, slug, scheme, bundleIdentifier and package in app.config.ts, appId and the visible title in .maestro/launch.yml, and the title in src/strings.ts, then run `npm run factory:lock`.
7. Show me the full diff of PRD.md and wait for my approval. Then run `npm run factory:spec`, `npm run typecheck` and `npm test`, and commit PRD.md and SPEC.md together with the message `prd: <what changed>`. Tell me to run `npm run factory:plan`.

Never edit SPEC.md by hand. It is generated.

Edit only the lines an answer changes. Never reword, reorder or reformat any other requirement or criterion: the loop re-derives a requirement's features and tests whenever its statement or criteria change, and throws away passing work to do it.
