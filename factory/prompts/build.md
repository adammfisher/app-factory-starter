Feature {id}: {title}
Requirement {requirement} · key {key}

Acceptance criteria:
{acceptance}

The tests in {tests} define done. Make them pass without breaking any other test. Read CLAUDE.md first. Work in app/ and src/. The app ships to iOS, Android and web from one code base, so everything you write must run on all three. The tests, factory/, .claude/, PRD.md, SPEC.md, features.json and questions.json are locked.

{failure}

Owner's answers so far:
{answers}

Before you finish, run `npx tsc --noEmit` and `npx jest --ci {tests}`. If you need something only the owner can supply, return it as a question with the default you proceeded on.
