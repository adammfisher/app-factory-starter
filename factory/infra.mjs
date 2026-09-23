#!/usr/bin/env node
// The infrastructure checker. Everything in infra/ must scale to zero: with no traffic, the bill is
// zero apart from data at rest. The rules are data in factory/infra-policy.json; this file applies them.
//   node factory/infra.mjs check              every infra/**/*.tf.json · exit 0 clean · 1 refused
//   node factory/infra.mjs plan <plan.json>   the type and attribute rules on `terraform show -json` output
// No Terraform binary, no AWS call, no model. The gate hands each refusal's fix to the next builder.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const refusal = (code, address, fix) => ({ code, address, fix });
const one = (v) => (Array.isArray(v) ? v[0] : v); // a nested block is an object, or a list of them
const get = (values, path) => path.split('.').reduce((v, key) => (one(v) && typeof one(v) === 'object' ? one(v)[key] : undefined), values);
const present = (v) => v != null && !(Array.isArray(v) && v.length === 0);
const literal = (v) => !JSON.stringify(v ?? null).includes('${');
const bare = (address) => address.replace(/\[[^\]]*\]$/, '');

export const loadPolicy = (cwd) => JSON.parse(readFileSync(join(cwd, 'factory/infra-policy.json'), 'utf8'));

/** Terraform JSON syntax -> resources, plus a refusal for every module block. */
export function readConfig(docs) {
  const resources = []; const refusals = [];
  for (const { json } of docs) {
    for (const block of [json.module ?? []].flat()) for (const name of Object.keys(block)) refusals.push(refusal('infra-module', `module.${name}`, 'write the resources inline: modules are refused in v1, so every resource sits in one visible configuration'));
    for (const block of [json.resource ?? []].flat()) for (const [type, byName] of Object.entries(block)) for (const [name, body] of Object.entries(byName ?? {})) resources.push({ address: `${type}.${name}`, type, values: one(body) ?? {} });
  }
  return { resources, refusals };
}

/** `terraform show -json` output -> managed resources, child modules included. Values are resolved there. */
export function readPlan(plan) {
  const resources = [];
  const walk = (mod = {}) => { for (const r of mod.resources ?? []) if (r.mode !== 'data') resources.push({ address: r.address, type: r.type, values: r.values ?? {} }); (mod.child_modules ?? []).forEach(walk); };
  walk(plan.planned_values?.root_module);
  return resources;
}

/** The type and attribute rules. literals: false in plan mode, where every value is already resolved. */
export function evaluate(resources, policy, { literals = true } = {}) {
  const out = []; const excepted = new Set();
  for (const e of policy.exceptions ?? []) {
    const type = bare(e.address ?? '').split('.').at(-2);
    const why = policy.alwaysOn[type] ? `an exception can never allow ${type} (${policy.alwaysOn[type]}); that takes an edit to alwaysOn itself`
      : !policy.fixedCharge[type] ? `exceptions are only for fixed monthly charges: ${Object.keys(policy.fixedCharge).join(', ')}`
      : !(String(e.reason ?? '').trim() && typeof e.monthlyUsd === 'number' && e.monthlyUsd >= 0 && /^owner \d{4}-\d{2}-\d{2}$/.test(e.approved ?? '')) ? 'give the exception a reason, a monthlyUsd number and approved: "owner YYYY-MM-DD"'
      : null;
    if (why) out.push(refusal('infra-exception-invalid', e.address ?? '(no address)', why));
    else if (!resources.some((r) => bare(r.address) === e.address)) out.push(refusal('infra-exception-stale', e.address, 'no resource has this address: remove the exception from factory/infra-policy.json'));
    else excepted.add(e.address);
  }
  for (const { address, type, values } of resources) {
    if (policy.alwaysOn[type]) { out.push(refusal('infra-always-on', address, `${policy.alwaysOn[type]}: remove it; it cannot scale to zero and no exception can allow it`)); continue; }
    if (policy.fixedCharge[type]) { if (!excepted.has(bare(address))) out.push(refusal('infra-fixed-charge', address, `fixed monthly charge: ${policy.fixedCharge[type]}; or the owner adds an exception to factory/infra-policy.json`)); continue; }
    if (!policy.allow[type]) { out.push(refusal('infra-type-not-allowed', address, `${type} is not on the allowlist in factory/infra-policy.json: use a type that is, or ask the owner`)); continue; }
    for (const id of policy.allow[type] ?? []) {
      const c = policy.conditions[id];
      if (c.rule === 'companion') { // another resource must name this one: by its literal value, or by a direct reference
        const key = c.pattern.match(/\{(\w+)\}/)[1]; const own = get(values, key);
        if (literals && !literal(own)) { out.push(refusal('infra-not-literal', address, `${key} must be a literal value, not an expression: the checker reads it as written`)); continue; }
        const names = [own, `\${${address}.${key}}`, `\${${address}.id}`].filter((x) => x != null).map((x) => c.pattern.replace(`{${key}}`, x));
        if (!resources.some((o) => o.type === c.type && names.includes(get(o.values, c.attr)))) out.push(refusal(c.code, address, c.fix));
        continue;
      }
      const v = get(values, c.attr);
      if (literals && !literal(v)) { out.push(refusal('infra-not-literal', address, `${c.attr} must be a literal value, not an expression: the checker reads it as written`)); continue; }
      const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
      const broken = {
        absent: () => present(v),
        equals: () => v !== c.value,
        notIn: () => c.values.includes(v),
        range: () => !(Number.isInteger(n) && n >= c.min && n <= policy.logRetentionMaxDays),
      }[c.rule];
      if (!broken || broken()) out.push(refusal(c.code ?? 'infra-attribute', address, `${c.attr}: ${c.fix}`));
    }
  }
  return out;
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '.terraform' ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));

/** Every rule, source form included, over infra/ in cwd. */
export function checkInfra(cwd, policy = loadPolicy(cwd)) {
  const files = walk(join(cwd, 'infra')).map((f) => relative(cwd, f).split(sep).join('/'));
  const refusals = files.filter((f) => f.endsWith('.tf')).map((f) => refusal('infra-hcl-present', f, 'rewrite it as .tf.json: the checker cannot read HCL, so a resource could hide there'));
  const docs = [];
  for (const file of files.filter((f) => f.endsWith('.tf.json'))) {
    try { docs.push({ file, json: JSON.parse(readFileSync(join(cwd, file), 'utf8')) }); } catch (error) { refusals.push(refusal('infra-parse', file, `not valid JSON (${error.message.split('\n')[0]}): fix the syntax`)); }
  }
  const config = readConfig(docs);
  return { resources: config.resources, refusals: [...refusals, ...config.refusals, ...evaluate(config.resources, policy)] };
}

function report(where, resources, refusals, policy) {
  for (const r of refusals) console.log(`REFUSED ${r.code} · ${r.address} · ${r.fix}`);
  const exceptions = policy.exceptions ?? [];
  const total = exceptions.reduce((sum, e) => sum + (Number(e.monthlyUsd) || 0), 0);
  console.log(`${where}: ${resources.length} resource(s) · ${refusals.length ? `${refusals.length} refusal(s)` : 'all scale to zero'} · ${exceptions.length} exception(s) at $${total.toFixed(2)}/month`);
  process.exit(refusals.length ? 1 : 0);
}

function main() {
  const [command, file] = process.argv.slice(2); const cwd = process.cwd();
  if (command === 'check') {
    if (!existsSync(join(cwd, 'infra'))) { console.log('no infra/: nothing to check'); process.exit(0); }
    const policy = loadPolicy(cwd); const { resources, refusals } = checkInfra(cwd, policy);
    report('infra/', resources, refusals, policy);
  } else if (command === 'plan' && file) {
    const policy = loadPolicy(cwd); let plan;
    try { plan = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { report(file, [], [refusal('infra-parse', file, `not a readable plan (${error.message.split('\n')[0]}): pass the output of terraform show -json`)], policy); }
    const resources = readPlan(plan);
    report(file, resources, evaluate(resources, policy, { literals: false }), policy);
  } else { console.error('usage: node factory/infra.mjs check | plan <plan.json>'); process.exit(64); }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(); // realpath: /var is a symlink on macOS
