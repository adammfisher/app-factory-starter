// The checker. Runs commands, reads exit codes, returns a JSON-able result.
// It never reads anything an agent wrote about its own work.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha = (file) =>
  existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;

const tail = (text, lines = 40) => text.trim().split('\n').slice(-lines).join('\n');

// Where does the failure live? Decided from tool output, which is machine-written.
// A missing RELATIVE module is unfinished work; a missing package is environment.
const ENVIRONMENT = [
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /\bENOENT\b/,
  /\bEACCES\b/,
  /npm ERR!/,
  /\bERESOLVE\b/,
  /Cannot find module '(?![./])/,
  /Unable to resolve module (?![./])/,
];
export const classify = (stage, output) =>
  stage === 'rails' ? 'rules' : ENVIRONMENT.some((re) => re.test(output)) ? 'environment' : 'work';

/** Oracle files (tests, flows) must be byte-identical to what was locked at plan time. */
export function oracleDrift(feature, cwd) {
  return Object.entries(feature.oracle ?? {})
    .filter(([file, hash]) => sha(join(cwd, file)) !== hash)
    .map(([file]) => file);
}

/** Run every stage in order; stop at the first red one. onStage(name, ok, seconds) reports progress. */
export function runGate(feature, stages, cwd, onStage = () => {}) {
  const steps = [];
  const drift = oracleDrift(feature, cwd);
  if (drift.length) {
    onStage('rails', false, 0);
    steps.push({ id: 'rails', ok: false, seconds: 0, exitCode: null });
    return { ok: false, steps, stage: 'rails', class: 'rules', cmd: null, exitCode: null, tail: `oracle files changed: ${drift.join(', ')}` };
  }
  for (const stage of stages) {
    const cmd = stage.cmd.replace('{tests}', (feature.tests ?? []).join(' '));
    const started = Date.now();
    const run = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    const seconds = Math.round((Date.now() - started) / 1000);
    onStage(stage.name, run.status === 0, seconds);
    steps.push({ id: stage.name, ok: run.status === 0, seconds, exitCode: run.status });
    if (run.status !== 0) {
      const output = tail(`${run.stdout ?? ''}\n${run.stderr ?? ''}`);
      return { ok: false, steps, stage: stage.name, class: classify(stage.name, output), cmd, exitCode: run.status, tail: output };
    }
  }
  return { ok: true, steps };
}
