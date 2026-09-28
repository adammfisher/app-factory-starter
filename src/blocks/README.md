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

A block never imports from another block's folder. Its tests live in `spec/blocks/<name>/`.
