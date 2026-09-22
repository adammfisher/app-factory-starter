#!/usr/bin/env node
// A $0 stand-in for `claude -p`, used only by factory/selftest.mjs. It speaks the same
// protocol (flags in, one JSON result out) and misbehaves on purpose so every rung of
// the ladder and every rail gets exercised without paying for a model.
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const streaming = args[args.indexOf('--output-format') + 1] === 'stream-json';
const phase = process.env.FACTORY_PHASE;
const id = (prompt.match(/Feature (F\d{3})/) ?? [])[1];
const emit = (message) => console.log(JSON.stringify(message));
const reply = (structured_output) => {
  if (streaming) emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'src/example.ts' } }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, structured_output });
};
const work = (value) => { mkdirSync('src', { recursive: true }); writeFileSync(`src/${id}.txt`, value); };
const TITLES = { 'R-001': 'retry works', 'R-002': 'cheats then blocks', 'R-003': 'first time', 'R-004': 'environment' };

if (process.env.FAKE_SLOW) await new Promise((r) => setTimeout(r, 200));

if (phase === 'plan') {
  const wanted = (prompt.split('Features that already exist')[0].match(/^R-\d{3}(?= )/gm) ?? []).filter((r, i, all) => all.indexOf(r) === i && TITLES[r]); // ids at line start: the uncovered list, not the prompt's example
  let features = wanted.map((r) => ({ title: TITLES[r], requirement: r, acceptance: [`the file for ${r} says done`] }));
  // misbehaviours the loop must refuse: five features for one requirement; a feature for a requirement already covered
  if (process.env.FAKE_OVERSPLIT && wanted.includes('R-004') && wanted.length > 1) features = [...features.filter((f) => f.requirement !== 'R-004'), ...[1, 2, 3, 4, 5].map((n) => ({ title: `environment part ${n}`, requirement: 'R-004', acceptance: ['the file for R-004 says done'] }))];
  if (process.env.FAKE_OVERPROPOSE) features.push({ title: 'retry works, again', requirement: 'R-001', acceptance: ['the file for R-001 says done'] });
  reply({ features });
} else if (phase === 'oracle') {
  if (process.env.FAKE_FAIL_ORACLE === id) { emit({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0.01 }); process.exit(1); }
  mkdirSync('spec', { recursive: true });
  writeFileSync(`spec/${id}.test.mjs`, `import { readFileSync } from 'node:fs';\nlet v = ''; try { v = readFileSync('src/${id}.txt', 'utf8'); } catch {}\nif (v.trim() !== 'done') { console.error('expected src/${id}.txt to say done, got "' + v + '"'); process.exit(1); }\n`);
  reply({ tests: [`spec/${id}.test.mjs`] });
} else if (phase === 'build' || phase === 'repair') {
  if (process.env.FAKE_MAXTURNS === id && !prompt.includes('ran out of turns')) { emit({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.01 }); process.exit(1); }
  const sawFailure = prompt.includes('The last attempt failed');
  if (id === 'F001') work(sawFailure ? 'done' : 'wrong');            // passes only once the reason reaches it
  else if (id === 'F002') {
    work('wrong');
    if (!sawFailure) writeFileSync('spec/F002.test.mjs', 'process.exit(0);\n'); // attempt 1: weaken the test
    else writeFileSync('features.json', '{"features":[{"id":"F002","status":"passing"}]}\n'); // later: forge the ledger
  } else if (id === 'F004') { work('done'); if (phase === 'repair') writeFileSync('tooling.ok', ''); }
  else work('done');
  // prose: the loop must ignore the summary. F001 also asks the same owner question on every attempt.
  reply({ summary: 'All tests pass and everything is perfect.', questions: id === 'F001' ? [{ type: 'fact', question: 'What is the support email?', default: 'support@example.com' }] : [] });
} else if (phase === 'replan') {
  reply({ action: 'block', reason: 'the requirement needs an owner decision', question: { type: 'preference', question: 'Ship without this feature?', default: 'Yes, ship without it.', blocking: false } });
}
