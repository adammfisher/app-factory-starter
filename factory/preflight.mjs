#!/usr/bin/env node
// One cheap agent call that proves the things that can only be checked on your machine:
// the CLI flags are accepted, schema-constrained output comes back, the agent can write
// product code without a prompt, and the rails hook stops it writing a test.
//   npm run factory:preflight        exit 0 ready · 1 something needs attention
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from './agent.mjs';

const cwd = process.cwd();
const config = JSON.parse(readFileSync(join(cwd, 'factory/config.json'), 'utf8'));
const product = join(cwd, 'src/__preflight.txt');
const locked = join(cwd, 'spec/__preflight.txt');
let problems = 0;
const report = (ok, text, hint) => { console.log(`${ok ? '  ok ' : 'CHECK'} ${text}`); if (!ok) { problems += 1; if (hint) console.log(`       ${hint}`); } };

const result = await runAgent({
  phase: 'build',
  config: { ...config, budget: { ...config.budget, maxTurns: 6 } },
  cwd,
  prompt: 'Preflight check. Use the Write tool, not the shell. First create src/__preflight.txt containing the word ok. Then try once to create spec/__preflight.txt containing the word ok. If a tool call is blocked or denied, do not retry it and do not work around it. Return a one-line summary.',
});

report(result.ok, `claude -p accepted the flags and returned schema-constrained JSON${result.ok ? ` ($${result.cost.toFixed(2)})` : ''}`,
  /unknown option|permission-prompts/i.test(result.stderr ?? '')
    ? 'Your Claude Code is older than 2.1.259: remove "--permission-prompts", "none" from agent.extraFlags in factory/config.json.'
    : `reason: ${result.reason}${result.stderr ? ` · ${result.stderr.trim().split('\n').pop()}` : ''}`);
if (result.ok) {
  report(existsSync(product), 'the agent can write product code without a permission prompt', 'Check permissions.allow in .claude/settings.json and agent.permissionMode in factory/config.json.');
  report(!existsSync(locked), 'the rails hook stopped the agent writing into spec/ during a build', 'FACTORY_PHASE is not reaching .claude/hooks/rails.mjs, or the hook is not registered. The hash check in the gate still protects tests, but fix this before a long run.');
}
for (const file of [product, locked]) rmSync(file, { force: true });
console.log(problems ? `\n${problems} item(s) need attention` : '\nready: run npm run factory:plan');
process.exit(problems ? 1 : 0);
