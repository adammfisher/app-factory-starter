# App factory template

One repo per app. This repo is an Expo app plus the loop that builds it. One code base ships to iOS, Android and web.

## Stack (pinned; these move together, never one at a time)
Expo SDK 54 · React Native 0.81.5 · React 19.1.0 · react-native-web 0.21 · TypeScript 5.9 strict · expo-router · Jest + React Native Testing Library · Maestro.
Install packages with `npx expo install <package>` so versions match the SDK. Keep the `overrides` block in package.json: several Expo packages declare wildcard peers, and without it npm installs a second, newer SDK beside this one.

## Where things live
- `PRD.md` the owner's document: why, for whom, requirements, metrics. For people. Agents in the loop do not read it.
- `SPEC.md` generated from the PRD. What agents read. Never edit it; change the PRD and run `npm run factory:spec`.
- `features.json` the ledger (the loop writes it; nobody else does). `questions.json` questions for the owner.
- `spec/` acceptance tests. They define done. `.maestro/` device flows.
- `app/` routes (expo-router; routes live here, not in `src/app`). `src/` everything else.
- `src/strings.ts` all user-facing copy. `src/theme.ts` all colours.
- `factory/` the loop.

## Rules
1. A feature is done when its tests in `spec/` pass and no other test broke. Nothing you say about your work counts.
2. Never change a test to make it pass. If a test is wrong, say so in a question.
3. No copy or colour literals in JSX. Use `src/strings.ts` and `src/theme.ts`.
4. Every touchable has an accessibility role and label, and is at least 44pt. Never set `accessible` on a container: it hides its children from screen readers.
5. Everything runs on iOS, Android and web. Prefer packages that support all three. When a module is native-only, add a `.web.ts` file beside it with a working fallback. The gate exports the web build on every feature.
6. Honour safe-area insets on every screen. Support light and dark. Layouts hold from a phone to a desktop browser: cap content width, never assume a touch screen.
7. Offline first: data stays on the device unless SPEC.md says otherwise. No secrets in the repo. Never run `eas submit`.
8. Ask the owner only for a fact, preference, credential or legal position. Give the default you will proceed on, and keep going.
9. Infrastructure lives in `infra/` as `*.tf.json`, at the versions pinned in `factory/infra-policy.json`, and must pass that policy (`node factory/infra.mjs check`), which the gate enforces: everything scales to zero. Never plan or apply. Every network call from the app goes through one module, `src/api.ts` (with a `.web.ts` fallback if needed), and tests replace that module. Scale to zero means cold starts, so the app handles a slow first response.

## Commands
`npm run typecheck` · `npm test` · `npx jest --ci spec/<file>` · `npx expo export --platform web --output-dir dist-web` · `npm run factory:status`

## Test conventions
Render with React Native Testing Library. Mock `react-native-safe-area-context` the way `spec/F001-launch.test.tsx` does. One `it` per acceptance criterion, named with the criterion's text. Test behaviour, not layout. `testID`s are kebab-case.
