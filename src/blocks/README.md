# Blocks

Each folder here is one self-contained capability (storage, camera, purchases…). The app keeps a
block by keeping its folder and drops it with `node src/blocks/remove.mjs <name>`.

Every block folder has:

- `index.ts` and `index.web.ts`: the public API for native and web. When `useFakes()` from
  `src/env.ts` is true (`EXPO_PUBLIC_USE_FAKES` is `"1"`), each exports the fake's values instead
  of the real ones.
- `fake.ts`: an in-memory implementation with the same exports.
- `config.js`: CommonJS, exports `{ plugins, ios: { infoPlist, privacyManifests: { NSPrivacyAccessedAPITypes } } }`.
  `app.config.ts` merges it only while the folder exists. Android permissions come through the
  block's config plugins.
- `block.json`: `{ "name", "packages", "env", "deviceChecks" }`. `packages` are what
  `remove.mjs` uninstalls when no other block lists them; `env` lists `EXPO_PUBLIC_*` names;
  each device check is a string or `{ "name" }`.

A block that needs native code keeps it in its own folder too: `expo-module.config.json` names the
modules, `ios/` holds the Swift and a podspec, and `android/` the Kotlin. `package.json` points
Expo's autolinking at `src/blocks` (`expo.autolinking.nativeModulesDir`), so a block's native half is
linked while its folder exists and dropped with it. The TypeScript reaches it with
`requireOptionalNativeModule`, so a build without it reads as "not-available" instead of crashing.

A block never imports from another block's folder. Its tests live in `spec/blocks/<name>/`.
