Feature {id}: {title}
Requirement {requirement} · key {key}

Acceptance criteria:
{acceptance}

Write the acceptance tests for this feature, and nothing else.
- Jest + React Native Testing Library, in spec/{id}-<short-slug>.test.tsx (or .test.ts for pure logic).
- One `it` per criterion, named with the criterion's exact text.
- Test behaviour, not layout: query by role, label, text or testID. Never assert styles, positions or component structure.
- Needs a device: {needsDevice}. If yes, also write a Maestro flow at .maestro/{id}.yml.
- The tests must fail now, because the feature does not exist yet. Do not write feature code.

Read CLAUDE.md for the stack and test conventions. Return the paths of the files you wrote.
