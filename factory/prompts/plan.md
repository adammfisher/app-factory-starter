Read SPEC.md and CLAUDE.md. SPEC.md is generated from the owner's PRD. Each flow has a requirement id (R-001), a key, a statement and acceptance criteria.

Turn these requirements into features, in the order they should be built:
{uncovered}

Features that already exist (do not propose features for their requirements):
{existing}

Rules:
- One feature per requirement by default. Split a requirement only when its criteria cannot be built and tested in one session, and never into more than {cap} features.
- A feature's acceptance criteria are its requirement's criteria, word for word. Add a criterion only to make an implied behaviour testable.
- Every feature names the one requirement it delivers. Every requirement listed above ends up covered.
- Pure calculation comes before screens, and screens before storage.
- Backend work in infra/ comes before the screens that call it.
- Set needsDevice to true only when a criterion can be seen only on a real screen.

Do not write or edit any file. Ask a question only when the answer is a fact, preference, credential or legal position that the owner alone holds, and give the default you will proceed on.
