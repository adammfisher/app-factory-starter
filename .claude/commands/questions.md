---
description: Answer the factory's open questions and write the answers back into the PRD
---
Read questions.json. For each entry whose `answer` is null, ask me in plain language, one at a time, and show the default the factory is proceeding on. Write what I say into `answer`. If I accept the default, write the default.

Every answer also goes into PRD.md, because the PRD is the record and questions.json is only the queue:
- If the answer changes what the product should do, edit the requirement or its acceptance criteria.
- Add a dated line under "Decisions": `- YYYY-MM-DD · R-00N · what was decided (owner)`.
- If I accepted a default without confirming it, add it under "Assumptions" ending with `(default, unconfirmed)` instead.

For every feature in features.json that is `blocked` and whose question is now answered: if its `lastFailure.stage` is `oracle`, set `status` to `planned` and `oracleAttempts` to 0 (the next plan rewrites its tests); otherwise set `status` to `todo` and `attempts` to 0. Remove `lastFailure` either way. If the answer was to drop the feature, set `status` to `superseded` instead.

Show me the diff of PRD.md and wait for my approval. Then run `npm run factory:spec` and commit. Tell me to run `npm run factory:plan` (it re-derives only the requirements that changed) and then `npm run factory:build`.

Edit only the lines an answer changes. Never reword, reorder or reformat any other requirement or criterion: the loop re-derives a requirement's features and tests whenever its statement or criteria change, and throws away passing work to do it.
