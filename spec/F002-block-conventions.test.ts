import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The contract these tests hold every block to:
// - src/blocks/<name>/ has index.ts, index.web.ts, fake.ts, config.js and block.json.
// - block.json is { "name": "<folder name>", "packages": string[], "env": ["EXPO_PUBLIC_…"],
//   "deviceChecks": (string | { "name": string })[] }.
// - config.js is CommonJS and exports ExpoConfig fragments: { plugins, ios: { infoPlist,
//   privacyManifests: { NSPrivacyAccessedAPITypes } } }. app.config.ts merges the config.js of
//   every folder present in src/blocks.
// - With EXPO_PUBLIC_USE_FAKES "1", every export of fake.ts is exported, as the same value, by
//   index.ts and index.web.ts.
// - A block never imports from another block's folder.

const ROOT = path.resolve(__dirname, '..');
const REAL_BLOCKS = path.join(ROOT, 'src', 'blocks');
const REQUIRED_FILES = ['index.ts', 'index.web.ts', 'fake.ts', 'config.js', 'block.json'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

type BlockJson = { name: string; packages: string[]; env: string[]; deviceChecks: (string | { name: string })[] };
type PrivacyEntry = { NSPrivacyAccessedAPIType: string; NSPrivacyAccessedAPITypeReasons: string[] };
type BlockConfig = {
  plugins?: unknown[];
  ios?: { infoPlist?: Record<string, unknown>; privacyManifests?: { NSPrivacyAccessedAPITypes?: PrivacyEntry[] } };
};

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f002-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function isDir(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function blockNames(blocksDir: string): string[] {
  if (!isDir(blocksDir)) return [];
  return fs
    .readdirSync(blocksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...sourceFiles(p));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /jest\.(?:mock|requireActual)\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  const out: string[] = [];
  for (const re of patterns) for (const m of source.matchAll(re)) if (m[1]) out.push(m[1]);
  return out;
}

// Where a specifier points inside blocksDir, or null when it points elsewhere.
function resolveIntoBlocks(specifier: string, fromFile: string, blocksDir: string): string | null {
  let target: string;
  if (specifier.startsWith('.')) {
    target = path.resolve(path.dirname(fromFile), specifier);
  } else {
    const alias = /^(?:@\/|~\/)?(?:src\/)?blocks\/(.+)$/.exec(specifier);
    if (!alias?.[1]) return null;
    target = path.join(blocksDir, alias[1]);
  }
  const rel = path.relative(blocksDir, target);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

function blockJsonProblems(name: string, file: string): string[] {
  let json: Partial<BlockJson>;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [`${name}: block.json is not valid JSON`];
  }
  const problems: string[] = [];
  const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (json.name !== name) problems.push(`${name}: block.json name must be "${name}"`);
  if (!isStringArray(json.packages)) problems.push(`${name}: block.json packages must list package names`);
  if (!isStringArray(json.env) || !json.env.every((v) => /^EXPO_PUBLIC_[A-Z0-9_]+$/.test(v)))
    problems.push(`${name}: block.json env must list EXPO_PUBLIC values`);
  const checks: unknown = json.deviceChecks;
  if (
    !Array.isArray(checks) ||
    !checks.every((c) => typeof c === 'string' || (typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string'))
  )
    problems.push(`${name}: block.json deviceChecks must list device checks`);
  return problems;
}

// The conventions test: every problem found in a blocks folder.
function conventionProblems(blocksDir: string): string[] {
  const problems: string[] = [];
  for (const name of blockNames(blocksDir)) {
    const dir = path.join(blocksDir, name);
    for (const file of REQUIRED_FILES) {
      if (!fs.existsSync(path.join(dir, file))) problems.push(`${name}: missing ${file}`);
    }
    if (fs.existsSync(path.join(dir, 'block.json'))) problems.push(...blockJsonProblems(name, path.join(dir, 'block.json')));
    for (const file of sourceFiles(dir)) {
      for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
        const rel = resolveIntoBlocks(spec, file, blocksDir);
        if (!rel) continue;
        const [other, ...rest] = rel.split(path.sep);
        if (other && other !== name && (rest.length > 0 || isDir(path.join(blocksDir, other)))) {
          problems.push(`${name}: ${path.relative(blocksDir, file)} imports from block ${other} (${spec})`);
        }
      }
    }
  }
  return problems;
}

function writeBlock(
  blocksDir: string,
  name: string,
  opts: { packages?: string[]; config?: string; files?: Record<string, string> } = {},
): void {
  const dir = path.join(blocksDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const blockJson: BlockJson = {
    name,
    packages: opts.packages ?? [],
    env: [],
    deviceChecks: ['opens'],
  };
  const files: Record<string, string> = {
    'index.ts': `export { ${name} } from './fake';\n`,
    'index.web.ts': `export { ${name} } from './fake';\n`,
    'fake.ts': `export const ${name} = { ok: true };\n`,
    'config.js': opts.config ?? 'module.exports = {};\n',
    'block.json': JSON.stringify(blockJson, null, 2),
    ...opts.files,
  };
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
}

// Copies the files at the top of src/blocks (remove.mjs and any shared helpers), not the blocks.
function copyBlocksTooling(toBlocksDir: string): void {
  fs.mkdirSync(toBlocksDir, { recursive: true });
  if (!isDir(REAL_BLOCKS)) return;
  for (const e of fs.readdirSync(REAL_BLOCKS, { withFileTypes: true })) {
    if (e.isFile()) fs.copyFileSync(path.join(REAL_BLOCKS, e.name), path.join(toBlocksDir, e.name));
  }
}

// Evaluates app.config.ts in a project folder the way the Expo CLI does.
function evalAppConfig(projectRoot: string): Record<string, any> {
  const evalConfigPath = path.join(ROOT, 'node_modules', '@expo', 'config', 'build', 'evalConfig.js');
  const script = `
    const path = require('path');
    const { evalConfig } = require(${JSON.stringify(evalConfigPath)});
    const root = process.cwd();
    const { config } = evalConfig(path.join(root, 'app.config.ts'), {
      projectRoot: root, staticConfigPath: null, packageJsonPath: path.join(root, 'package.json'), config: {},
    });
    process.stdout.write(JSON.stringify(config));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: projectRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`app.config.ts failed to evaluate:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function configProject(): string {
  const dir = tempDir();
  fs.copyFileSync(path.join(ROOT, 'app.config.ts'), path.join(dir, 'app.config.ts'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  copyBlocksTooling(path.join(dir, 'src', 'blocks'));
  return dir;
}

function privacyReasons(config: Record<string, any>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const entries: PrivacyEntry[] = config.ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? [];
  for (const e of entries) {
    const set = out.get(e.NSPrivacyAccessedAPIType) ?? new Set<string>();
    for (const r of e.NSPrivacyAccessedAPITypeReasons ?? []) set.add(r);
    out.set(e.NSPrivacyAccessedAPIType, set);
  }
  return out;
}

function expectConfigIncludes(config: Record<string, any>, block: BlockConfig): void {
  for (const plugin of block.plugins ?? []) expect(config.plugins).toContainEqual(plugin);
  for (const [key, value] of Object.entries(block.ios?.infoPlist ?? {})) expect(config.ios?.infoPlist?.[key]).toEqual(value);
  const reasons = privacyReasons(config);
  for (const e of block.ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? []) {
    for (const r of e.NSPrivacyAccessedAPITypeReasons) expect(reasons.get(e.NSPrivacyAccessedAPIType)?.has(r)).toBe(true);
  }
}

// A project with two blocks, a fake npm on PATH that edits package.json, and remove.mjs.
function removeProject(): { dir: string; env: NodeJS.ProcessEnv; npmLog: string } {
  const dir = tempDir();
  const tools = tempDir();
  const blocksDir = path.join(dir, 'src', 'blocks');
  copyBlocksTooling(blocksDir);
  writeBlock(blocksDir, 'camera', { packages: ['expo-camera', 'shared-pkg'] });
  writeBlock(blocksDir, 'storage', { packages: ['expo-file-system', 'shared-pkg'] });
  for (const name of ['camera', 'storage']) {
    fs.mkdirSync(path.join(dir, 'spec', 'blocks', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec', 'blocks', name, `${name}.test.ts`), `it('works', () => {});\n`);
  }
  const pkg = {
    name: 'remove-fixture',
    private: true,
    dependencies: { 'expo-camera': '1.0.0', 'expo-file-system': '1.0.0', 'shared-pkg': '1.0.0', react: '19.1.0' },
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  const npmLog = path.join(tools, 'npm.log');
  const bin = path.join(tools, 'bin');
  fs.mkdirSync(bin);
  const fakeNpm = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(npmLog)}, JSON.stringify(args) + '\\n');
if (['uninstall', 'remove', 'rm', 'r', 'un', 'unlink'].includes(args[0])) {
  const file = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const name of args.slice(1).filter((a) => !a.startsWith('-'))) {
    for (const field of ['dependencies', 'devDependencies']) if (pkg[field]) delete pkg[field][name];
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\\n');
}
`;
  fs.writeFileSync(path.join(bin, 'npm'), fakeNpm, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
  return { dir, env, npmLog };
}

function runRemove(dir: string, env: NodeJS.ProcessEnv, name: string) {
  const script = path.join(dir, 'src', 'blocks', 'remove.mjs');
  expect(fs.existsSync(script)).toBe(true);
  const result = spawnSync(process.execPath, [script, name], { cwd: dir, env, encoding: 'utf8' });
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isDirectory()) {
        out[`${rel}/`] = '';
        walk(p);
      } else {
        out[rel] = fs.readFileSync(p, 'utf8');
      }
    }
  };
  walk(dir);
  return out;
}

function dependencies(dir: string): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
}

describe('F002 block conventions', () => {
  it('Every folder in src/blocks has index.ts, index.web.ts, fake.ts, config.js and a block.json listing its name, packages, EXPO_PUBLIC values and device checks; a folder missing any of these fails the conventions test.', () => {
    expect(isDir(REAL_BLOCKS)).toBe(true);
    expect(conventionProblems(REAL_BLOCKS)).toEqual([]);

    const fixture = path.join(tempDir(), 'blocks');
    writeBlock(fixture, 'alpha');
    expect(conventionProblems(fixture)).toEqual([]);

    for (const file of REQUIRED_FILES) {
      const dir = path.join(tempDir(), 'blocks');
      writeBlock(dir, 'alpha');
      fs.rmSync(path.join(dir, 'alpha', file));
      expect(conventionProblems(dir).length).toBeGreaterThan(0);
    }

    for (const key of ['name', 'packages', 'env', 'deviceChecks']) {
      const dir = path.join(tempDir(), 'blocks');
      writeBlock(dir, 'alpha');
      const file = path.join(dir, 'alpha', 'block.json');
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      delete json[key];
      fs.writeFileSync(file, JSON.stringify(json));
      expect(conventionProblems(dir).length).toBeGreaterThan(0);
    }

    const badEnv = path.join(tempDir(), 'blocks');
    writeBlock(badEnv, 'alpha');
    const badEnvFile = path.join(badEnv, 'alpha', 'block.json');
    fs.writeFileSync(badEnvFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(badEnvFile, 'utf8')), env: ['SECRET_KEY'] }));
    expect(conventionProblems(badEnv).length).toBeGreaterThan(0);
  });

  it("A file inside one block that imports from another block's folder fails the conventions test.", () => {
    expect(isDir(REAL_BLOCKS)).toBe(true);
    expect(conventionProblems(REAL_BLOCKS).filter((p) => p.includes('imports from block'))).toEqual([]);

    const own = path.join(tempDir(), 'blocks');
    writeBlock(own, 'alpha', { files: { 'helper.ts': `import { alpha } from './fake';\nexport const h = alpha;\n` } });
    writeBlock(own, 'beta');
    expect(conventionProblems(own)).toEqual([]);

    const imports = [
      `import { beta } from '../beta/fake';\n`,
      `export * from '../beta';\n`,
      `const b = require('../beta/index');\n`,
      `import { beta } from 'src/blocks/beta';\n`,
      `import { beta } from '@/blocks/beta/fake';\n`,
    ];
    for (const line of imports) {
      const dir = path.join(tempDir(), 'blocks');
      writeBlock(dir, 'alpha', { files: { 'deep/helper.ts': line.replace('../', '../../') } });
      writeBlock(dir, 'beta');
      const problems = conventionProblems(dir);
      expect(problems.some((p) => p.startsWith('alpha:') && p.includes('beta'))).toBe(true);
    }
  });

  it("app.config.ts includes a block's config plugins, permission texts and privacy manifest entries only when that block's folder exists.", () => {
    const zeta: BlockConfig = {
      plugins: [['zeta-config-plugin', { microphonePermission: 'Zeta listens to test the factory.' }]],
      ios: {
        infoPlist: { NSMicrophoneUsageDescription: 'Zeta listens to test the factory.' },
        privacyManifests: {
          NSPrivacyAccessedAPITypes: [
            { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryActiveKeyboards', NSPrivacyAccessedAPITypeReasons: ['54BD.1'] },
          ],
        },
      },
    };
    const eta: BlockConfig = {
      plugins: ['eta-config-plugin'],
      ios: { infoPlist: { NSPhotoLibraryUsageDescription: 'Eta reads photos to test the factory.' } },
    };

    const withZeta = configProject();
    writeBlock(path.join(withZeta, 'src', 'blocks'), 'zeta', { config: `module.exports = ${JSON.stringify(zeta)};\n` });
    writeBlock(path.join(withZeta, 'src', 'blocks'), 'eta', { config: `module.exports = ${JSON.stringify(eta)};\n` });
    const present = evalAppConfig(withZeta);
    expectConfigIncludes(present, zeta);
    expectConfigIncludes(present, eta);
    expect(present.plugins).toContain('expo-router');
    expect(privacyReasons(present).get('NSPrivacyAccessedAPICategoryFileTimestamp')?.has('C617.1')).toBe(true);

    const withoutZeta = configProject();
    writeBlock(path.join(withoutZeta, 'src', 'blocks'), 'eta', { config: `module.exports = ${JSON.stringify(eta)};\n` });
    const absent = evalAppConfig(withoutZeta);
    expectConfigIncludes(absent, eta);
    expect(JSON.stringify(absent.plugins)).not.toContain('zeta-config-plugin');
    expect(absent.ios?.infoPlist?.NSMicrophoneUsageDescription).toBeUndefined();
    expect(privacyReasons(absent).has('NSPrivacyAccessedAPICategoryActiveKeyboards')).toBe(false);
    expect(absent.plugins).toContain('expo-router');

    const real = configProject();
    for (const name of blockNames(REAL_BLOCKS)) fs.cpSync(path.join(REAL_BLOCKS, name), path.join(real, 'src', 'blocks', name), { recursive: true });
    const realConfig = evalAppConfig(real);
    for (const name of blockNames(REAL_BLOCKS)) {
      expectConfigIncludes(realConfig, require(path.join(REAL_BLOCKS, name, 'config.js')) as BlockConfig);
    }
  }, 60000);

  it('When EXPO_PUBLIC_USE_FAKES is "1", each block\'s index returns its fake instead of the real implementation.', () => {
    expect(isDir(REAL_BLOCKS)).toBe(true);
    const previous = process.env.EXPO_PUBLIC_USE_FAKES;
    process.env.EXPO_PUBLIC_USE_FAKES = '1';
    try {
      for (const name of blockNames(REAL_BLOCKS)) {
        for (const index of ['index', 'index.web']) {
          jest.isolateModules(() => {
            const fake: Record<string, unknown> = require(path.join(REAL_BLOCKS, name, 'fake'));
            const entry: Record<string, unknown> = require(path.join(REAL_BLOCKS, name, index));
            const names = Object.keys(fake);
            expect(names.length).toBeGreaterThan(0);
            for (const key of names) expect({ block: name, index, key, same: entry[key] === fake[key] }).toEqual({ block: name, index, key, same: true });
          });
        }
      }
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_USE_FAKES;
      else process.env.EXPO_PUBLIC_USE_FAKES = previous;
    }
  });

  it('node src/blocks/remove.mjs camera deletes src/blocks/camera and spec/blocks/camera and uninstalls each package that no remaining block lists.', () => {
    const { dir, env } = removeProject();
    runRemove(dir, env, 'camera');

    expect(fs.existsSync(path.join(dir, 'src', 'blocks', 'camera'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'spec', 'blocks', 'camera'))).toBe(false);
    expect(isDir(path.join(dir, 'src', 'blocks', 'storage'))).toBe(true);
    expect(isDir(path.join(dir, 'spec', 'blocks', 'storage'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'src', 'blocks', 'remove.mjs'))).toBe(true);

    const deps = dependencies(dir);
    expect(deps).not.toContain('expo-camera');
    expect(deps).toEqual(expect.arrayContaining(['shared-pkg', 'expo-file-system', 'react']));
  }, 30000);

  it('node src/blocks/remove.mjs with a name that is not a block prints "No block named" followed by the name and changes nothing.', () => {
    const { dir, env, npmLog } = removeProject();
    const before = snapshot(dir);
    const result = runRemove(dir, env, 'teleporter');

    expect(result.output).toMatch(/No block named\W*teleporter\b/);
    expect(snapshot(dir)).toEqual(before);
    expect(fs.existsSync(npmLog) ? fs.readFileSync(npmLog, 'utf8').trim() : '').toBe('');
  }, 30000);
});
