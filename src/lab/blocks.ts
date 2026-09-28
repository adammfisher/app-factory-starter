// The blocks the Block Lab lists: one entry per folder in src/blocks, found at build time, so a
// block added or removed with remove.mjs needs no change here. Each block's block.json names its
// device checks; its lab.ts (optional when there are none) exports `deviceChecks`, the functions
// that run them. Nothing here runs a check.
import type { DeviceChecks } from './check';

export type LabCheck = { name: string; run: () => Promise<unknown> };
export type LabBlock = { name: string; deviceChecks: LabCheck[] };

type BlockJson = { deviceChecks?: (string | { name: string })[] };
type Context = { keys(): string[]; (key: string): unknown };

// Metro (iOS, Android and web) supports require.context. Jest does not, so under Jest the same
// folder is read with Node; Metro never takes that branch, and module.require keeps Node's
// modules out of the app bundle.
function blocksContext(): Context {
  if (typeof require.context === 'function') {
    return require.context('../blocks', true, /^\.\/[^/]+\/(block\.json|lab\.ts)$/) as Context;
  }
  const load = module.require.bind(module) as (id: string) => unknown;
  const fs = load('fs') as typeof import('fs');
  const path = load('path') as typeof import('path');
  const root = path.join(__dirname, '..', 'blocks');
  const keys = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .flatMap((e) => ['block.json', 'lab.ts'].filter((f) => fs.existsSync(path.join(root, e.name, f))).map((f) => `./${e.name}/${f}`));
  return Object.assign((key: string) => load(path.join(root, key)), { keys: () => keys });
}

function checkName(entry: string | { name: string }): string {
  return typeof entry === 'string' ? entry : entry.name;
}

function missing(block: string, name: string): () => Promise<unknown> {
  return async () => {
    throw new Error(`No "${name}" in src/blocks/${block}/lab.ts`);
  };
}

function load(): LabBlock[] {
  const context = blocksContext();
  const keys = context.keys();
  const blocks: LabBlock[] = [];
  for (const key of keys) {
    const match = /^\.\/([^/]+)\/block\.json$/.exec(key);
    if (!match?.[1]) continue;
    const name = match[1];
    const json = context(key) as BlockJson;
    const labKey = `./${name}/lab.ts`;
    const lab = keys.includes(labKey) ? ((context(labKey) as { deviceChecks?: DeviceChecks }).deviceChecks ?? {}) : {};
    blocks.push({
      name,
      deviceChecks: (json.deviceChecks ?? []).map(checkName).map((check) => ({ name: check, run: lab[check] ?? missing(name, check) })),
    });
  }
  return blocks;
}

export const labBlocks: LabBlock[] = load();
