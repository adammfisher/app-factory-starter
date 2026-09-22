Feature {id}: {title}
Requirement {requirement} · key {key}

A check keeps failing for a reason that may live outside the feature code: tooling, configuration, dependencies, the environment, or a module that does not run on one of the platforms (iOS, Android, web).

{failure}

Find the cause and repair it. You may edit configuration files and package.json, install packages with `npx expo install <package>`, add Jest mocks under __mocks__/, and add a `.web.ts` fallback for a native-only module. The tests, factory/, .claude/, PRD.md, SPEC.md, features.json and questions.json are locked. Then make the check pass.

Before you finish, run `npx tsc --noEmit` and `npx jest --ci {tests}`.
