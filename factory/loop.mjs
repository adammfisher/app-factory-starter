#!/usr/bin/env node
// The control loop: goal -> agent builds -> machine checks -> compare -> next action.
//   node factory/loop.mjs plan     SPEC.md -> features + locked failing tests. Resumable. Re-derives only changed requirements.
//   node factory/loop.mjs build    one fresh agent per feature; failures climb the ladder
//   node factory/loop.mjs status   questions waiting, a reading per requirement, the features
//   node factory/loop.mjs trace    <R-nnn | Fnnn | key | sha>  walk requirement -> feature -> tests -> commit -> gate artifact
//   node factory/loop.mjs lock     re-hash the oracle after YOU edit a test or flow (owner only)
// Exit: 0 done · 1 plan left requirements uncovered · 2 budget reached · 3 trace has a gap · 4 blocked features waiting · 64 refused to start
//
// State lives in JSON files and git, never in an agent. Decisions read exit codes and
// schema-constrained JSON, never prose.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runAgent } from './agent.mjs';
import { oracleDrift, runGate, sha } from './gate.mjs';
import { parsePrd, requirementHashes, specState } from './prd.mjs';

const cwd = process.cwd();
const at = (...p) => join(cwd, ...p);
const readJson = (file, fallback) => (existsSync(at(file)) ? JSON.parse(readFileSync(at(file), 'utf8')) : fallback);
const serialise = (data) => `${JSON.stringify(data, null, 2)}\n`;
const writeJson = (file, data) => { mkdirSync(join(at(file), '..'), { recursive: true }); writeFileSync(at(file), serialise(data)); };

const config = readJson('factory/config.json');
const state = readJson('features.json', { features: [] });
const queue = readJson('questions.json', { questions: [] });
const startedAt = Date.now();
let spent = 0;

const save = () => { writeJson('features.json', state); writeJson('questions.json', queue); };
const say = (text) => console.log(text);
const log = (event) => { // the durable record; console wording lives in say()
  mkdirSync(at('factory/state'), { recursive: true });
  appendFileSync(at('factory/state/log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
};
const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const commit = (message, trailers = {}) => {
  git('add', '-A');
  const body = Object.entries(trailers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  git('commit', '-qm', body ? `${message}\n\n${body}` : message);
};
const prompt = (name, vars) =>
  readFileSync(at('factory/prompts', `${name}.md`), 'utf8').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
const clock = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const nextId = () => `F${String(Math.max(0, ...state.features.map((f) => Number(f.id.slice(1)))) + 1).padStart(3, '0')}`;
const live = (f) => f.status !== 'superseded';
const overBudget = () => spent >= config.budget.maxCostUsdPerRun;
const readPrd = () => (existsSync(at('PRD.md')) ? parsePrd(readFileSync(at('PRD.md'), 'utf8')) : { requirements: [] });

function requireSpec() {
  const spec = specState(cwd);
  if (!spec.ok) { console.error(`factory: refused (${spec.code}). ${spec.fix}`); process.exit(64); }
}
function stopForBudget(where) {
  log({ event: 'budget-reached', detail: `$${spent.toFixed(2)} during ${where}` });
  save();
  say(`[factory] budget reached ($${spent.toFixed(2)}). Run npm run factory:${where} again to continue.`);
  status();
  process.exit(2);
}

// ---- the human queue: typed questions with defaults; the loop never waits on a reversible one
function ask(featureId, questions = []) {
  for (const q of questions) {
    if (queue.questions.some((k) => k.feature === featureId && k.question === q.question)) continue; // asked already
    queue.questions.push({ id: `Q${String(queue.questions.length + 1).padStart(3, '0')}`, feature: featureId, ...q, answer: null });
    log({ event: 'question', feature: featureId, detail: `${q.type}: ${q.question} (default: ${q.default})` });
    say(`    ? ${q.type} question filed: ${q.question}\n      proceeding on: ${q.default}`);
  }
}
const answersFor = (featureId) =>
  queue.questions
    .filter((q) => q.feature === featureId || q.feature === null)
    .map((q) => `- ${q.question} -> ${q.answer ?? `${q.default} (default, unanswered)`}`)
    .join('\n');

// ---- rails backstop: hooks guard Edit/Write; this catches everything else (e.g. shell writes)
const lockedDirty = () => git('status', '--porcelain', '--', ...config.locked).stdout.split('\n').filter(Boolean)
  .map((line) => line.slice(3)).filter((file) => !file.startsWith('factory/state/'));
function restoreRails(feature, before) {
  const restored = [];
  for (const file of oracleDrift(feature, cwd)) { git('checkout', '--', file); restored.push(file); }
  for (const file of lockedDirty()) { git('checkout', '--', file); git('clean', '-fdq', '--', file); restored.push(file); }
  // The ledger, the queue, the PRD and the SPEC belong to the owner and the loop. An agent's edits to them are discarded.
  for (const [file, snapshot] of Object.entries(before)) {
    if (readFileSync(at(file), 'utf8') !== snapshot) { writeFileSync(at(file), snapshot); restored.push(file); }
  }
  return restored;
}

// ---- one agent call, with a bounded continuation when the session runs out of turns
async function call(phase, feature, vars, headline) {
  say(`[factory] ${headline}`);
  const max = config.budget.maxContinuations ?? 0;
  let text = prompt(phase, vars);
  let result; let continuations = 0;
  for (;;) {
    result = await runAgent({ phase, prompt: text, config, cwd });
    spent += result.cost;
    log({ event: 'agent', feature: feature?.id, phase, ok: result.ok, cost: result.cost, seconds: result.seconds, detail: result.reason ?? undefined });
    say(`    ${result.ok ? 'agent finished' : `agent stopped early (${result.reason})`} · ${clock(result.seconds * 1000)} · $${result.cost.toFixed(2)}`);
    if (result.ok || !/max_turns/.test(result.reason ?? '') || continuations >= max || overBudget()) break;
    continuations += 1;
    log({ event: 'continuation', feature: feature?.id, phase, detail: `${continuations} of ${max}` });
    say(`    ran out of turns · continuing from the working tree (${continuations} of ${max})`);
    text = `${prompt(phase, vars)}\n\nA previous session ran out of turns partway through this task. Its changes are in the working tree. Continue from there; do not start over.`;
  }
  return result;
}

const describe = (f) => ({ id: f.id, title: f.title, requirement: f.requirement ?? 'none', key: f.key ?? 'none', acceptance: f.acceptance.map((a) => `- ${a}`).join('\n'), tests: (f.tests ?? []).join(' ') });
const failureBlock = (f) => (f.lastFailure
  ? `The last attempt failed the "${f.lastFailure.stage}" check${f.lastFailure.cmd ? ` (\`${f.lastFailure.cmd}\`, exit ${f.lastFailure.exitCode})` : ''}. Output:\n${f.lastFailure.tail}\nFix the cause of this failure.`
  : '');
const stageLine = (name, ok, seconds) => say(`    gate ${name.padEnd(10)} ${ok ? 'ok ' : 'RED'} (${seconds}s)`);

// ---- the gate artifact: the only admissible evidence. Not committed; cited by runId in the commit trailer.
function writeArtifact(feature, phase, gate) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${feature.id}`;
  writeJson(`factory/state/results/${runId}/result.json`, {
    runId, feature: feature.id, requirement: feature.requirement ?? null, key: feature.key ?? null, phase, at: new Date().toISOString(),
    steps: gate.steps ?? [], exit: gate.ok ? 0 : 1, failed: gate.ok ? null : { stage: gate.stage, class: gate.class, cmd: gate.cmd, exitCode: gate.exitCode },
  });
  return runId;
}

// ---- oracle: tests are written before the work and must be red first
async function writeOracle(feature, position) {
  for (const dir of ['spec', '.maestro']) { // leftovers from an interrupted run
    if (existsSync(at(dir))) for (const name of readdirSync(at(dir))) if (name.startsWith(`${feature.id}-`) || name.startsWith(`${feature.id}.`)) rmSync(at(dir, name), { force: true });
  }
  const result = await call('oracle', feature, { ...describe(feature), needsDevice: feature.needsDevice ? 'yes' : 'no' }, `oracle ${feature.id} (${position}) · writing failing tests for "${feature.title}"`);
  if (result.ok) ask(feature.id, result.data.questions);
  const files = result.ok ? [...result.data.tests, ...(result.data.flows ?? [])] : [];
  const valid = files.length > 0 && files.every((f) => (f.startsWith('spec/') || f.startsWith('.maestro/')) && existsSync(at(f)));
  if (!valid) {
    feature.oracleAttempts = (feature.oracleAttempts ?? 0) + 1;
    feature.lastFailure = { stage: 'oracle', class: 'goal', tail: result.reason ?? 'oracle files missing or outside spec/ and .maestro/' };
    if (feature.oracleAttempts >= 2) { // every block files a question: nobody below the owner can fix a requirement nothing can test
      feature.status = 'blocked';
      ask(feature.id, [{ type: 'preference', question: `${feature.id} "${feature.title}": tests could not be written after two attempts (${feature.lastFailure.tail}). Rewrite the criteria of ${feature.requirement ?? 'this requirement'}, or drop it?`, default: 'Leave it blocked and ship without it.' }]);
    }
    say(`    no usable tests (${feature.lastFailure.tail}) · ${feature.status === 'blocked' ? 'blocked, question filed' : 'will retry on the next plan'}`);
    log({ event: 'oracle', feature: feature.id, detail: `failed: ${feature.lastFailure.tail}` });
    return;
  }
  feature.tests = result.data.tests;
  feature.oracle = Object.fromEntries(files.map((f) => [f, sha(at(f))]));
  delete feature.lastFailure;
  say(`    wrote ${files.join(', ')}`);
  const red = runGate(feature, config.gate.filter((s) => s.name === 'spec'), cwd, stageLine);
  feature.status = red.ok ? 'passing' : 'todo';
  if (red.ok) feature.greenAtPlan = true;
  log({ event: 'oracle', feature: feature.id, detail: red.ok ? 'already green at plan time' : 'red first: confirmed' });
  say(`    ${red.ok ? 'already green: nothing to build' : 'red first: confirmed, tests locked'}`);
}

async function writePending() {
  const pending = state.features.filter((f) => f.status === 'planned');
  for (const [index, feature] of pending.entries()) {
    if (overBudget()) stopForBudget('plan');
    await writeOracle(feature, `${index + 1} of ${pending.length}`);
    save();
    commit(`spec(${feature.id}): ${feature.status === 'planned' || feature.status === 'blocked' ? 'oracle failed' : 'lock the oracle'}`, { Feature: feature.id, Requirement: feature.requirement, Key: feature.key });
  }
}

function supersede(feature, why) {
  for (const file of Object.keys(feature.oracle ?? {})) rmSync(at(file), { force: true });
  Object.assign(feature, { status: 'superseded', oracle: {}, tests: [] });
  log({ event: 'superseded', feature: feature.id, detail: why });
  say(`[factory] ${feature.id} superseded · ${why}`);
}

async function plan() {
  requireSpec();
  const prd = readPrd();
  const hashes = requirementHashes(prd);
  const byId = Object.fromEntries(prd.requirements.map((r) => [r.id, r]));
  const cap = config.plan?.maxFeaturesPerRequirement ?? 4;
  // A changed or removed requirement re-derives only its own branch. A re-tag or a reformat changes nothing.
  for (const f of state.features.filter(live)) {
    if (!f.requirement) continue;
    if (hashes[f.requirement] !== f.reqHash) supersede(f, hashes[f.requirement] ? `${f.requirement} changed in the PRD` : `${f.requirement} was removed from the PRD`);
    else if (byId[f.requirement].fields.Key !== f.key) { f.key = byId[f.requirement].fields.Key; log({ event: 'retagged', feature: f.id, detail: f.key }); }
  }
  save();
  const uncovered = () => prd.requirements.filter((r) => !state.features.some((f) => live(f) && f.requirement === r.id));

  await writePending(); // resume: finish what an earlier plan proposed before asking for more
  for (let round = 0; round < 2 && uncovered().length; round += 1) {
    if (overBudget()) stopForBudget('plan');
    const need = uncovered(); const needIds = new Set(need.map((r) => r.id));
    const result = await call('plan', null, {
      uncovered: need.map((r) => `${r.id} ${r.title}`).join('\n'),
      cap: String(cap),
      existing: state.features.filter(live).map((f) => `${f.id} ${f.requirement ?? '-'} ${f.title}`).join('\n') || '(none)',
    }, `plan · turning ${need.length} requirement(s) from SPEC.md into features (one long agent call)`);
    if (!result.ok) break;
    ask(null, result.data.questions);
    const proposed = {};
    for (const p of result.data.features) (proposed[p.requirement] ??= []).push(p);
    for (const [reqId, list] of Object.entries(proposed)) {
      if (!byId[reqId]) { log({ event: 'plan-unknown-requirement', detail: reqId }); say(`    ignored ${list.length} proposal(s) for ${reqId}: not in the PRD`); continue; }
      if (!needIds.has(reqId)) { log({ event: 'plan-already-covered', detail: reqId }); say(`    ignored ${list.length} proposal(s) for ${reqId}: already covered`); continue; }
      if (list.length > cap) { log({ event: 'plan-oversplit', detail: `${reqId}: ${list.length}` }); say(`    refused ${reqId}: ${list.length} features proposed, the cap is ${cap} · asking again`); continue; }
      for (const p of list) {
        const feature = { id: nextId(), ...p, key: byId[reqId].fields.Key, reqHash: hashes[reqId], status: 'planned', tests: [], oracle: {}, attempts: 0, depth: 0 };
        state.features.push(feature);
        say(`    ${feature.id}  ${feature.requirement}  ${feature.title}  · ${feature.acceptance.length} criteria${feature.needsDevice ? ' · device' : ''}`);
      }
    }
    save();
    commit('spec: features proposed');
    await writePending();
  }

  const left = uncovered(); const by = (s) => state.features.filter((f) => f.status === s).length;
  say(`\n[factory] plan done · ${by('todo')} to build · ${by('passing')} passing · ${by('planned')} still planned · ${by('blocked')} blocked · ${queue.questions.filter((q) => q.answer === null).length} question(s) · $${spent.toFixed(2)} · ${clock(Date.now() - startedAt)}`);
  if (left.length) { say(`          not covered by any feature: ${left.map((r) => r.id).join(', ')}. Run npm run factory:plan again.`); process.exit(1); }
  say(by('planned') ? '          next: npm run factory:plan again to finish the planned features' : '          next: read spec/ (the tests define done), then npm run factory:build');
}

// ---- ladder: retry -> repair -> re-plan -> person. Each failure goes to the lowest level that can fix it.
async function replan(feature) {
  const result = await call('replan', feature, { ...describe(feature), attempts: String(feature.attempts), failure: failureBlock(feature) }, `re-plan ${feature.id} · deciding whether to split it or ask the owner`);
  const d = result.ok && result.data.action ? result.data : { action: 'block', reason: result.reason ?? 're-plan returned no action' };
  const parts = d.features ?? [];
  const covers = feature.acceptance.every((a) => parts.some((p) => p.acceptance.includes(a)));
  if (d.action === 'split' && feature.depth < 1 && parts.length >= 2 && covers) {
    const index = state.features.indexOf(feature);
    const made = [];
    for (const p of parts) { const part = { id: nextId(), ...p, requirement: feature.requirement, key: feature.key, reqHash: feature.reqHash, status: 'planned', tests: [], oracle: {}, attempts: 0, depth: feature.depth + 1 }; state.features.push(part); made.push(part); }
    state.features.splice(state.features.length - made.length, made.length); state.features.splice(index + 1, 0, ...made);
    supersede(feature, `split into ${made.map((m) => m.id).join(', ')}`);
    log({ event: 'split', feature: feature.id, detail: made.map((m) => m.id).join(', ') });
    await writePending();
  } else {
    feature.status = 'blocked';
    ask(feature.id, [d.question ?? { type: 'preference', question: `${feature.id} "${feature.title}" could not be completed: ${d.reason}. Drop it, or change the requirement?`, default: 'Leave it blocked and ship without it.' }]);
    log({ event: 'blocked', feature: feature.id, detail: d.reason });
    say(`[factory] ${feature.id} blocked · ${d.reason} · moving on to the next feature`);
  }
}

async function buildFeature(feature) {
  const steps = [...Array(config.ladder.retry).fill('build'), ...Array(config.ladder.repair).fill('repair')];
  for (const [index, planned] of steps.entries()) {
    if (overBudget()) return 'budget';
    // Route, don't retry: an environment failure goes straight to repair.
    const phase = feature.lastFailure?.class === 'environment' ? 'repair' : planned;
    feature.attempts += 1;
    save();
    const before = Object.fromEntries(['features.json', 'questions.json', 'PRD.md', 'SPEC.md'].map((f) => [f, readFileSync(at(f), 'utf8')]));
    const result = await call(phase, feature, { ...describe(feature), failure: failureBlock(feature), answers: answersFor(feature.id) },
      `${phase} ${feature.id} · attempt ${index + 1} of ${steps.length} · "${feature.title}"${feature.lastFailure ? ` · last failure: ${feature.lastFailure.stage} (${feature.lastFailure.class})` : ''}`);
    const restored = restoreRails(feature, before);
    if (result.ok) ask(feature.id, result.data.questions); // after the rails check, so a new question is never mistaken for tampering
    const gate = restored.length
      ? { ok: false, steps: [{ id: 'rails', ok: false, seconds: 0, exitCode: null }], stage: 'rails', class: 'rules', cmd: null, exitCode: null, tail: `You changed locked files (restored): ${restored.join(', ')}. Work in app/ and src/ only.` }
      : runGate(feature, config.gate, cwd, stageLine);
    if (restored.length) say(`    rails: restored ${restored.join(', ')}`);
    const runId = writeArtifact(feature, phase, gate);
    log({ event: 'gate', feature: feature.id, phase, ok: gate.ok, runId, detail: gate.ok ? undefined : `${gate.stage} (${gate.class})` });
    if (gate.ok) {
      feature.status = 'passing';
      delete feature.lastFailure;
      save();
      commit(`feat(${feature.id}): ${feature.title}`, { Feature: feature.id, Requirement: feature.requirement, Key: feature.key, Gate: runId });
      say(`[factory] ${feature.id} passing · committed · gate ${runId}`);
      return 'passing';
    }
    feature.lastFailure = gate;
    save();
    say(`[factory] ${feature.id} red at ${gate.stage} (${gate.class}) · the reason goes into the next attempt`);
  }
  await replan(feature);
  save();
  commit(`chore(${feature.id}): ${feature.status}`, { Feature: feature.id, Requirement: feature.requirement });
  return feature.status;
}

async function build() {
  requireSpec();
  const dirty = lockedDirty();
  if (dirty.length) { console.error(`factory: uncommitted changes in locked paths (${dirty.join(', ')}). Commit them first; the loop restores these paths after every agent run.`); process.exit(64); }
  // A blocked feature never blocks unrelated work: keep going down the list.
  for (let i = 0; i < state.features.length; i += 1) {
    const feature = state.features[i];
    if (feature.status !== 'todo') continue;
    if (await buildFeature(feature) === 'budget') stopForBudget('build');
  }
  status();
  process.exit(state.features.some((f) => f.status === 'blocked') ? 4 : 0);
}

// ---- status: the inbox first, then a reading per requirement, then the features
function countLines(dir) {
  if (!existsSync(at(dir))) return 0;
  return readdirSync(at(dir), { withFileTypes: true }).reduce((sum, entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'state' || entry.name === 'node_modules' ? sum : sum + countLines(rel);
    return /\.(mjs|js|ts|tsx)$/.test(entry.name) && statSync(at(rel)).isFile() ? sum + readFileSync(at(rel), 'utf8').split('\n').length : sum;
  }, 0);
}
function status() {
  const by = (s) => state.features.filter((f) => f.status === s).length;
  const spec = specState(cwd);
  const open = queue.questions.filter((q) => q.answer === null);
  say(`\nquestions waiting: ${open.length}${open.some((q) => q.blocking) ? ' (some blocking)' : ''} — answer with /questions in Claude Code`);
  for (const q of open) say(`  ${q.id}  ${q.type.padEnd(10)} ${q.question}  (proceeding on: ${q.default})`);
  say(`PRD -> SPEC: ${spec.ok ? 'in step' : `${spec.code} · ${spec.fix}`}`);
  const prd = readPrd();
  if (prd.requirements.length) say('requirements (read from the ledger, never claimed):');
  for (const r of prd.requirements) {
    const own = state.features.filter((f) => live(f) && f.requirement === r.id);
    const reading = !own.length ? 'unverifiable · no feature' : own.every((f) => f.status === 'passing') ? 'met' : own.some((f) => f.status === 'blocked') ? 'unmet · blocked' : 'unmet';
    say(`  ${r.id}  ${reading.padEnd(24)} ${(r.fields.Key ?? '').padEnd(30)} ${r.title}`);
  }
  say(`features: ${by('passing')} passing · ${by('todo')} todo · ${by('planned')} planned · ${by('blocked')} blocked · ${by('superseded')} superseded${by('superseded') ? ' (ids are never reused, so numbering climbs)' : ''}`);
  for (const f of state.features.filter(live)) say(`  ${f.id}  ${f.status.padEnd(9)} ${(f.requirement ?? '-').padEnd(6)} ${(f.key ?? '').padEnd(30)} ${f.title}${f.lastFailure ? `  [${f.lastFailure.stage}/${f.lastFailure.class}]` : ''}`);
  say(`machinery ${countLines('factory') + countLines('.claude')} lines · product ${countLines('app') + countLines('src')} lines · spent this run $${spent.toFixed(2)}\n`);
}

// ---- trace: walk the chain both ways; a link it cannot join is printed as a gap, never guessed
function trace(query) {
  const prd = readPrd();
  let features;
  if (/^R-\d{3}$/.test(query)) features = state.features.filter((f) => live(f) && f.requirement === query);
  else if (/^F\d{3}$/.test(query)) features = state.features.filter((f) => f.id === query);
  else if (/^[0-9a-f]{7,40}$/.test(query)) {
    const id = (git('log', '-1', '--format=%B', query).stdout.match(/^Feature: (F\d{3})$/m) ?? [])[1];
    features = id ? state.features.filter((f) => f.id === id) : [];
  } else features = state.features.filter((f) => live(f) && f.key === query);
  if (!features.length) { say(`nothing resolves for ${query}`); process.exit(2); }
  let gaps = 0;
  const gap = (text) => { gaps += 1; say(`  ✗ ${text}`); };
  for (const f of features) {
    const r = prd.requirements.find((x) => x.id === f.requirement);
    if (r) say(`${r.id}  ${r.title}  (${r.fields.Key})`); else if (f.requirement) gap(`${f.requirement} is not in PRD.md`); else say('(no requirement: seed feature)');
    say(`  → ${f.id}  ${f.status}  "${f.title}"`);
    if (f.tests?.length) say(`  → tests ${f.tests.join(', ')}`); else gap('no tests: the oracle has not run');
    const sha7 = git('log', '-1', '--format=%h', `--grep=^Feature: ${f.id}$`, `--grep=^feat(${f.id})`, '--all-match').stdout.trim();
    if (!sha7) { gap(`no commit: the feature is ${f.status}`); continue; }
    say(`  → commit ${sha7}`);
    const runId = (git('log', '-1', '--format=%B', sha7).stdout.match(/^Gate: (\S+)$/m) ?? [])[1];
    if (!runId) { gap('the commit carries no Gate trailer'); continue; }
    const artifact = readJson(`factory/state/results/${runId}/result.json`, null);
    if (!artifact) { gap(`gate ${runId}: artifact not on this machine (factory/state is not committed)`); continue; }
    say(`  → gate ${runId}  exit ${artifact.exit}  ${artifact.steps.map((s) => `${s.id}=${s.ok ? 'pass' : 'fail'}`).join(' ')}`);
  }
  process.exit(gaps ? 3 : 0);
}

function lock() {
  for (const f of state.features) for (const file of Object.keys(f.oracle ?? {})) f.oracle[file] = sha(at(file));
  save();
  say('oracle re-locked');
}

const [command, argument] = process.argv.slice(2);
if (command === 'plan') await plan();
else if (command === 'build') await build();
else if (command === 'status') status();
else if (command === 'trace' && argument) trace(argument);
else if (command === 'lock') lock();
else { console.error('usage: node factory/loop.mjs plan | build | status | trace <R-nnn|Fnnn|key|sha> | lock'); process.exit(64); }
