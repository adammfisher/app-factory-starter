#!/usr/bin/env node
// A guard that cannot fail is not a guard. For each mutation in factory/sim/mutations.json this
// breaks one behaviour of the loop in a temporary copy and proves the self-test turns red for
// the right reason. Costs $0, about a minute.  npm run factory:guards
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mutations = JSON.parse(readFileSync(join(root, 'factory/sim/mutations.json'), 'utf8'));
let bad = 0;
for (const m of mutations) {
  const copy = mkdtempSync(join(tmpdir(), 'factory-guard-'));
  for (const d of ['factory', '.claude']) cpSync(join(root, d), join(copy, d), { recursive: true, filter: (src) => !src.includes('/state/') });
  const file = join(copy, m.file); const source = readFileSync(file, 'utf8');
  const hits = source.split(m.find).length - 1;
  if (hits !== 1) { console.log(`ERROR ${m.name}: "find" matches ${hits} times in ${m.file}; update factory/sim/mutations.json`); bad += 1; rmSync(copy, { recursive: true, force: true }); continue; }
  writeFileSync(file, source.replace(m.find, m.replace));
  const run = spawnSync('node', [join(copy, 'factory/selftest.mjs')], { encoding: 'utf8', env: { ...process.env, FACTORY_AGENT_CMD: '' } });
  const red = run.status !== 0 && run.stdout.includes(`FAIL  ${m.mustFail}`);
  console.log(`${red ? '  red ' : 'ERROR'} ${m.name}${red ? '' : ` — expected "FAIL  ${m.mustFail}", got exit ${run.status}`}`);
  if (!red) bad += 1;
  rmSync(copy, { recursive: true, force: true });
}
console.log(bad ? `\n${bad} guard(s) did not fire: the self-test no longer discriminates` : `\nall ${mutations.length} guards fire`);
process.exit(bad ? 1 : 0);
