#!/usr/bin/env node
// Removes a block from the app: `node src/blocks/remove.mjs <name>`.
// Deletes src/blocks/<name> and spec/blocks/<name>, then uninstalls each package in its
// block.json that no remaining block lists. app.config.ts drops the block's config on its own,
// since it only merges the folders that exist.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const blocksDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(blocksDir, '..', '..');

function blockNames() {
  return fs
    .readdirSync(blocksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

function packagesOf(name) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(blocksDir, name, 'block.json'), 'utf8'));
    return Array.isArray(json.packages) ? json.packages.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

const name = process.argv[2];
if (!name) {
  console.error('Usage: node src/blocks/remove.mjs <block name>');
  process.exit(1);
}
if (!blockNames().includes(name)) {
  console.error(`No block named ${name}. Blocks: ${blockNames().join(', ') || 'none'}`);
  process.exit(1);
}

const packages = packagesOf(name);
const stillListed = new Set(blockNames().filter((b) => b !== name).flatMap(packagesOf));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installed = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
const toUninstall = packages.filter((p) => !stillListed.has(p) && installed.has(p));

fs.rmSync(path.join(blocksDir, name), { recursive: true, force: true });
fs.rmSync(path.join(root, 'spec', 'blocks', name), { recursive: true, force: true });
console.log(`Removed src/blocks/${name} and spec/blocks/${name}.`);

if (toUninstall.length > 0) {
  console.log(`Uninstalling ${toUninstall.join(', ')}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['uninstall', ...toUninstall], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`npm uninstall failed. Run it yourself: npm uninstall ${toUninstall.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}
