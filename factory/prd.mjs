#!/usr/bin/env node
// The front door. PRD.md is authored truth; SPEC.md is a projection of it.
//   node factory/prd.mjs lint [--json]   check the PRD mechanically · exit 0 clean · 1 refusals
//   node factory/prd.mjs spec            lint, then generate SPEC.md stamped with the PRD's hash
// No model is involved in either command. The interview that fills gaps is /prd in Claude Code.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADER = ['Product', 'Owner', 'Version', 'Status', 'Platforms'];
const SECTIONS = ['Objective', 'Users and journeys', 'Outcome metrics', 'Requirements', 'Rules and invariants',
  "What can't be undone", 'Dependencies', 'Out of scope', 'Not decided yet', 'Assumptions', 'Decisions'];
const TYPES = ['new-capability', 'enhancement', 'change', 'fix'];
const PRIORITIES = ['must', 'should', 'could'];
const PLATFORMS = ['ios', 'android', 'web'];
const KEY = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){2}$/;
const VAGUE = /\b(fast|quick|quickly|easy|easily|intuitive|user-friendly|seamless|robust|appropriate|appropriately|as needed|etc|and so on|nice|clean|modern|simple)\b/i;

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function parsePrd(text) {
  const prd = { title: '', header: {}, prose: {}, lists: {}, metrics: [], requirements: [], format: [] };
  let section = null; let item = null; let inAcceptance = false;
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\s*<!--.*-->\s*$/.test(line)) return;
    let m;
    if ((m = line.match(/^# PRD\s+[—-]\s+(.+)$/))) { prd.title = m[1]; return; }
    if ((m = line.match(/^## (.+)$/))) { section = m[1].trim(); item = null; inAcceptance = false; return; }
    if (section === null) {
      if ((m = line.match(/^- ([A-Za-z ]+): (.*)$/))) prd.header[m[1].trim()] = m[2].trim();
      else prd.format.push(`line ${index + 1}: expected "- Field: value" in the header`);
      return;
    }
    if (section === 'Outcome metrics' || section === 'Requirements') {
      const isReq = section === 'Requirements';
      if ((m = line.match(isReq ? /^### (R-\d{3}) (.+)$/ : /^### (M-\d{2}) (.+)$/))) {
        item = { id: m[1], title: m[2].trim(), fields: {}, acceptance: [] };
        (isReq ? prd.requirements : prd.metrics).push(item); inAcceptance = false; return;
      }
      if (item && (m = line.match(/^- ([A-Za-z ]+):\s*(.*)$/))) {
        inAcceptance = isReq && m[1] === 'Acceptance';
        if (!inAcceptance) item.fields[m[1].trim()] = m[2].trim();
        return;
      }
      if (item && inAcceptance && (m = line.match(/^\s{2,}- (.+)$/))) { item.acceptance.push(m[1].trim()); return; }
      prd.format.push(`line ${index + 1}: not valid inside "${section}": ${line.trim().slice(0, 60)}`);
      return;
    }
    if (section === 'Objective' || section === 'Users and journeys') { prd.prose[section] = `${prd.prose[section] ?? ''}${line.trim()}\n`; return; }
    if ((m = line.match(/^- (.+)$/))) { if (!/^none\.?$/i.test(m[1].trim())) (prd.lists[section] ??= []).push(m[1].trim()); else prd.lists[section] ??= []; return; }
    if (/^none\.?$/i.test(line.trim())) { prd.lists[section] ??= []; return; }
    prd.format.push(`line ${index + 1}: expected a "- " bullet in "${section}"`);
  });
  prd.sectionsSeen = new Set([...Object.keys(prd.prose), ...Object.keys(prd.lists), ...(prd.metrics.length ? ['Outcome metrics'] : []), ...(prd.requirements.length ? ['Requirements'] : [])]);
  return prd;
}

/** Deterministic refusals. Each is a named code, where it is, and what would fix it. */
export function lintPrd(prd, { requireKeys = false, requireDecided = false, requireReady = false } = {}) {
  const out = []; const refuse = (code, where, fix) => out.push({ code, where, fix });
  for (const f of prd.format) refuse('prd-format', f, 'Use the exact line shapes in factory/templates/PRD.template.md.');
  const filled = [['title', prd.title], ...Object.entries(prd.header), ...Object.entries(prd.prose),
    ...[...prd.metrics, ...prd.requirements].flatMap((i) => [[i.id, i.title], ...Object.entries(i.fields).map(([k, v]) => [`${i.id} ${k}`, v]), ...i.acceptance.map((a, n) => [`${i.id} criterion ${n + 1}`, a])]),
    ...Object.entries(prd.lists).flatMap(([name, items]) => items.map((x) => [name, x]))];
  for (const [where, value] of filled) if (/<[^<>]+>/.test(value ?? '')) refuse('prd-placeholder', where, 'Replace the <placeholder> from the template with real content.');
  if (!prd.title) refuse('prd-format', 'title', 'First line must be "# PRD — <name>".');
  for (const h of HEADER) if (!prd.header[h]) refuse('prd-header-missing', h, `Add "- ${h}: ..." under the title.`);
  if (prd.header.Product && !/^[a-z0-9-]+$/.test(prd.header.Product)) refuse('prd-header-invalid', 'Product', 'Lower-case letters, digits and dashes only.');
  const platforms = (prd.header.Platforms ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (prd.header.Platforms && (!platforms.length || platforms.some((p) => !PLATFORMS.includes(p)))) refuse('prd-platforms-invalid', 'Platforms', `Use any of: ${PLATFORMS.join(', ')}.`);
  for (const s of SECTIONS) if (!prd.sectionsSeen.has(s) && !(s in prd.lists)) refuse('prd-section-missing', s, `Add "## ${s}". Write "None." if it is empty.`);
  if (!(prd.prose.Objective ?? '').trim()) refuse('prd-objective-empty', 'Objective', 'State the outcome in one or two sentences.');
  if (!prd.metrics.length) refuse('prd-no-metrics', 'Outcome metrics', 'Add at least one metric, or you cannot tell whether this worked.');
  for (const m of prd.metrics) for (const f of ['Baseline', 'Target', 'Timeframe', 'Measured by']) if (!m.fields[f]) refuse('prd-metric-missing-field', `${m.id} ${f}`, `Add "- ${f}: ...".`);
  if (!prd.requirements.length) refuse('prd-no-requirements', 'Requirements', 'Add at least one "### R-001 <title>".');
  const seen = new Set();
  for (const r of prd.requirements) {
    if (seen.has(r.id)) refuse('prd-requirement-duplicate-id', r.id, 'Give every requirement its own id.'); seen.add(r.id);
    if (!r.fields.Statement) refuse('prd-requirement-missing-field', `${r.id} Statement`, 'Say what must be true, in one or two sentences.');
    if (!TYPES.includes(r.fields.Type)) refuse('prd-requirement-bad-type', `${r.id} Type`, `One of: ${TYPES.join(', ')}.`);
    if (!PRIORITIES.includes(r.fields.Priority)) refuse('prd-requirement-bad-priority', `${r.id} Priority`, `One of: ${PRIORITIES.join(', ')}.`);
    if (!r.acceptance.length) refuse('prd-requirement-no-acceptance', r.id, 'Add "- Acceptance:" with at least one indented, testable criterion.');
    r.acceptance.forEach((a, i) => { const v = a.match(VAGUE); if (v) refuse('prd-acceptance-vague', `${r.id} criterion ${i + 1}`, `"${v[0]}" cannot be tested. Replace it with a number, a limit or an exact result.`); });
    if (r.fields.Key && !KEY.test(r.fields.Key)) refuse('prd-key-bad-format', `${r.id} Key`, 'Use domain.capability.feature in lower case, for example payments.autopay.schedule.');
    if (requireKeys && !r.fields.Key) refuse('prd-key-missing', r.id, 'Run /prd to tag it, or add "- Key: domain.capability.feature".');
  }
  if (requireReady && prd.header.Status !== 'ready') refuse('prd-not-approved', 'Status', 'Set "- Status: ready" once the owner has approved the PRD. /prd does this at the end of the interview.');
  if (requireDecided) for (const open of prd.lists['Not decided yet'] ?? []) refuse('prd-undecided', open.slice(0, 70), 'Run /prd: decide it, or move it to Assumptions with the default you accept.');
  return out;
}

// What a requirement's tests are derived from. Wording of the statement and the criteria only:
// a re-tag, a reformat or a priority change must not throw away passing work.
const norm = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
export const requirementHashes = (prd) => Object.fromEntries(prd.requirements.map((r) =>
  [r.id, sha256(JSON.stringify([norm(r.fields.Statement), r.acceptance.map(norm)])).slice(0, 16)]));

export function renderSpec(prd, hash) {
  const order = [...prd.requirements].sort((a, b) => PRIORITIES.indexOf(a.fields.Priority) - PRIORITIES.indexOf(b.fields.Priority));
  const list = (name) => ((prd.lists[name] ?? []).length ? prd.lists[name].map((x) => `- ${x}`).join('\n') : 'None.');
  return [
    `<!-- GENERATED from PRD.md by factory/prd.mjs. Do not edit: change the PRD, then run npm run factory:spec. prd-sha256: ${hash} -->`,
    `# SPEC — ${prd.title}`, '',
    `Platforms: ${prd.header.Platforms}. Every flow must work on each of them.`, '',
    '## What it is', (prd.prose.Objective ?? '').trim(), '',
    '## Flows (build in this order)',
    ...order.map((r) => [`### ${r.id} · ${r.fields.Key} · ${r.title}`, r.fields.Statement, 'Acceptance:', ...r.acceptance.map((a) => `- ${a}`), ''].join('\n')),
    '## Rules and invariants', list('Rules and invariants'), '',
    "## What can't be undone", list("What can't be undone"), '',
    '## Dependencies', list('Dependencies'), '',
    '## Out of scope', list('Out of scope'), '',
    '## Decisions', list('Decisions'), '',
    '## Assumptions (defaults nobody has confirmed yet)', list('Assumptions'), '',
  ].join('\n');
}

export const specStamp = (specText) => (specText.match(/prd-sha256: ([0-9a-f]{64})/) ?? [])[1] ?? null;

/** Is SPEC.md the projection of the PRD as it stands now? */
export function specState(cwd) {
  const prdFile = join(cwd, 'PRD.md'); const specFile = join(cwd, 'SPEC.md');
  if (!existsSync(prdFile)) return { ok: false, code: 'prd-missing', fix: 'Create PRD.md from factory/templates/PRD.template.md, or run /prd.' };
  if (!existsSync(specFile)) return { ok: false, code: 'spec-missing', fix: 'Run /prd in Claude Code: it finishes the PRD with you and generates SPEC.md. If the PRD is already complete, run npm run factory:spec.' };
  const current = sha256(readFileSync(prdFile, 'utf8'));
  return specStamp(readFileSync(specFile, 'utf8')) === current ? { ok: true } : { ok: false, code: 'spec-stale', fix: 'PRD.md changed after SPEC.md was generated. Run npm run factory:spec.' };
}

function main() {
  const [command, flag] = process.argv.slice(2); const cwd = process.cwd();
  if (!['lint', 'spec'].includes(command)) { console.error('usage: node factory/prd.mjs lint [--json] | spec'); process.exit(64); }
  if (!existsSync(join(cwd, 'PRD.md'))) { console.error('prd-missing: no PRD.md. Copy factory/templates/PRD.template.md, or run /prd in Claude Code.'); process.exit(1); }
  const text = readFileSync(join(cwd, 'PRD.md'), 'utf8'); const prd = parsePrd(text);
  const refusals = lintPrd(prd, command === 'spec' ? { requireKeys: true, requireDecided: true, requireReady: true } : {});
  if (flag === '--json') console.log(JSON.stringify({ refusals, open: prd.lists['Not decided yet'] ?? [], untagged: prd.requirements.filter((r) => !r.fields.Key).map((r) => r.id) }, null, 2));
  else {
    for (const r of refusals) console.log(`REFUSED ${r.code} · ${r.where}\n        ${r.fix}`);
    const open = prd.lists['Not decided yet'] ?? []; const untagged = prd.requirements.filter((r) => !r.fields.Key);
    if (command === 'lint') console.log(`${refusals.length ? `\n${refusals.length} refusal(s).` : 'PRD is well formed.'} ${prd.requirements.length} requirements · ${prd.metrics.length} metrics · ${open.length} not decided · ${untagged.length} without a key`);
    if (command === 'lint' && !refusals.length && (open.length || untagged.length)) console.log('Next: run /prd in Claude Code to settle open items and tag keys.');
  }
  if (refusals.length) process.exit(1);
  if (command === 'spec') { writeFileSync(join(cwd, 'SPEC.md'), renderSpec(prd, sha256(text))); console.log(`SPEC.md generated from PRD.md (${prd.requirements.length} flows). Next: npm run factory:plan`); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
