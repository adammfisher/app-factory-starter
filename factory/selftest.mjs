#!/usr/bin/env node
// End-to-end run of the real front door and the real loop against a fake agent in a throwaway
// repo. Costs $0. Run after every change to factory/ or .claude/hooks/:  npm run factory:selftest
// npm run factory:guards proves these checks still discriminate, by breaking the loop on purpose.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintPrd, parsePrd, requirementHashes, sha256, specStamp } from './prd.mjs';
import { runAgent } from './agent.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'factory-selftest-'));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', ...opts });
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : ` — ${String(detail).slice(0, 400)}`}`); if (!ok) failed += 1; };
const codes = (text, opts) => lintPrd(parsePrd(text), opts).map((r) => r.code);
const strict = { requireKeys: true, requireDecided: true, requireReady: true };
const ledger = () => Object.fromEntries(JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')).features.map((f) => [f.id, f]));
const readLog = () => readFileSync(join(dir, 'factory/state/log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const events = (name) => readLog().filter((e) => e.event === name);
const gates = (id) => events('gate').filter((e) => e.feature === id);

// ---- 1. the front door: PRD lint and SPEC generation (no agent involved)
console.log('PRD and SPEC');
const ready = readFileSync(join(root, 'factory/templates/PRD.sample-ready.md'), 'utf8');
check('green control: the interview-complete sample has no refusals', codes(ready, strict).length === 0, codes(ready, strict));
check('a vague criterion is refused', codes(ready.replace('shows 33.34 each and 0.02 extra', 'is easy to read')).includes('prd-acceptance-vague'));
check('a requirement with no acceptance criteria is refused', codes(ready.replace(/- Acceptance:\n(  - .*\n)+/, '')).includes('prd-requirement-no-acceptance'));
check('a malformed key is refused', codes(ready.replace('tipsplit.calculator.tip', 'Tip Calculator')).includes('prd-key-bad-format'));
check('a metric without a baseline is refused', codes(ready.replace('- Baseline: 0\n', '')).includes('prd-metric-missing-field'));
check('a line outside the template shapes is refused, with its line number', lintPrd(parsePrd(ready.replace('- Type: new-capability', 'Type = new'))).some((r) => r.code === 'prd-format' && /line \d+/.test(r.where)));
const draft = codes(readFileSync(join(root, 'factory/templates/PRD.template.md'), 'utf8'));
check('the blank template is refused until it is filled in', draft.includes('prd-objective-empty') && draft.includes('prd-placeholder'));
const open = ready.replace('## Not decided yet\n- None.', '## Not decided yet\n- Which colour?').replace('- Key: tipsplit.history.save\n', '');
check('SPEC generation refuses open decisions and untagged requirements', ['prd-undecided', 'prd-key-missing'].every((c) => codes(open, strict).includes(c)) && codes(open).length === 0);
const unapproved = ready.replace('- Status: ready', '- Status: draft');
check('SPEC generation refuses a PRD the owner has not marked ready; the lint alone does not', codes(unapproved, strict).includes('prd-not-approved') && !codes(unapproved).includes('prd-not-approved'));
const reformatted = ready.replace('- Priority: must\n- Statement: The person enters a bill amount,', '- Priority: should\n- Statement:  The person  enters a bill amount,');
check('a re-tag, a priority change or a reformat does not change a requirement hash', JSON.stringify(requirementHashes(parsePrd(reformatted))) === JSON.stringify(requirementHashes(parsePrd(ready))));
check('a changed criterion does change it', requirementHashes(parsePrd(ready.replace('shows 33.34 each', 'shows 33.33 each')))['R-002'] !== requirementHashes(parsePrd(ready))['R-002']);

// ---- a throwaway project that uses the REAL prd.mjs, loop, gate, agent runner and prompts
for (const f of ['loop.mjs', 'gate.mjs', 'agent.mjs', 'prd.mjs', 'infra.mjs', 'infra-policy.json', 'prompts']) cpSync(join(root, 'factory', f), join(dir, 'factory', f), { recursive: true });
const config = JSON.parse(readFileSync(join(root, 'factory/config.json'), 'utf8'));
config.gate = [{ name: 'tooling', cmd: 'node tools-check.mjs' }, { name: 'spec', cmd: 'node {tests}' }];
const writeConfig = (cap) => writeFileSync(join(dir, 'factory/config.json'), JSON.stringify({ ...config, budget: { ...config.budget, maxCostUsdPerRun: cap } }, null, 2));
writeConfig(config.budget.maxCostUsdPerRun);
writeFileSync(join(dir, 'tools-check.mjs'), "import { existsSync } from 'node:fs';\nif (existsSync('src/F004.txt') && !existsSync('tooling.ok')) { console.error('sh: expo-doctor: command not found'); process.exit(127); }\n");
const requirement = (n) => `### R-00${n} req ${n}\n- Type: new-capability\n- Key: selftest.files.r${n}\n- Priority: must\n- Statement: The file for R-00${n} says done.\n- Acceptance:\n  - the file for R-00${n} says done\n`;
const tailSections = ['Rules and invariants', "What can't be undone", 'Dependencies', 'Out of scope', 'Not decided yet', 'Assumptions', 'Decisions'].map((s) => `## ${s}\n- None.\n`).join('\n');
const prdText = `# PRD — Selftest\n- Product: selftest\n- Owner: nobody\n- Version: 0.1\n- Status: ready\n- Platforms: ios, android, web\n\n## Objective\nProve the loop.\n\n## Users and journeys\nNone.\n\n## Outcome metrics\n### M-01 Checks\n- Baseline: 0\n- Target: all\n- Timeframe: now\n- Measured by: this script\n\n## Requirements\n${[1, 2, 3, 4].map(requirement).join('\n')}\n${tailSections}`;
writeFileSync(join(dir, 'PRD.md'), prdText);
writeFileSync(join(dir, 'CLAUDE.md'), '# selftest\n');
writeFileSync(join(dir, '.gitignore'), 'factory/state/\n');
sh('git', ['init', '-q', '-b', 'main']); sh('git', ['config', 'user.email', 'selftest@factory']); sh('git', ['config', 'user.name', 'selftest']);

const env = { ...process.env, FACTORY_AGENT_CMD: `node ${join(root, 'factory/sim/fake-agent.mjs')}`, FACTORY_HEARTBEAT_MS: '60' };
const noSpec = sh('node', ['factory/loop.mjs', 'plan'], { env });
check('plan refuses to start without a SPEC.md', noSpec.status === 64 && /spec-missing/.test(noSpec.stderr), noSpec.stderr);
const gen1 = sh('node', ['factory/prd.mjs', 'spec']); const spec1 = readFileSync(join(dir, 'SPEC.md'), 'utf8');
sh('node', ['factory/prd.mjs', 'spec']);
check('SPEC.md is a deterministic projection stamped with the PRD hash', gen1.status === 0 && spec1 === readFileSync(join(dir, 'SPEC.md'), 'utf8') && specStamp(spec1) === sha256(prdText), gen1.stdout + gen1.stderr);
sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'init']);

// ---- 2. plan: the budget, an over-split refusal, an interrupted oracle, and resume without re-planning
console.log('\nplan');
writeConfig(0.02); // planner 0.01 + first oracle 0.01 = cap
const planA = sh('node', ['factory/loop.mjs', 'plan'], { env: { ...env, FAKE_OVERSPLIT: '1' } });
const midA = ledger();
check('an over-split requirement is refused, with a log line naming it', events('plan-oversplit').some((e) => e.detail === 'R-004: 5') && !Object.values(midA).some((f) => f.requirement === 'R-004'), planA.stdout);
check('plan stops at the budget (exit 2) and leaves the rest planned', planA.status === 2 && midA.F001.status === 'todo' && midA.F002.status === 'planned' && midA.F003.status === 'planned', `exit ${planA.status}\n${planA.stdout}`);
writeConfig(config.budget.maxCostUsdPerRun);
const plannerCalls = () => events('agent').filter((e) => e.phase === 'plan').length;
const plan1 = sh('node', ['factory/loop.mjs', 'plan'], { env: { ...env, FAKE_FAIL_ORACLE: 'F003', FAKE_SLOW: '1' } });
const mid = ledger();
check('plan says what it is doing: a start line per call, a heartbeat, the proposed features, a summary', ['oracle F002 (1 of 2)', 'still working', 'F004  R-004  environment', 'plan done'].every((t) => plan1.stdout.includes(t)), plan1.stdout);
check('a second plan resumes: covered requirements are not planned again, only the refused one is asked for', plannerCalls() === 2 && /turning 1 requirement/.test(plan1.stdout) && mid.F004?.requirement === 'R-004' && Object.values(mid).filter((f) => f.requirement === 'R-004').length === 1, plan1.stdout);
check('an oracle that fails twice blocks the feature and files a question for the owner', mid.F003.status === 'blocked' && mid.F003.lastFailure?.stage === 'oracle' && JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf8')).questions.some((q) => q.feature === 'F003' && q.type === 'preference'), JSON.stringify(mid.F003));
// the owner answers (what /questions does for an oracle block): back to planned, tests to be rewritten
const answered = JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8'));
Object.assign(answered.features.find((f) => f.id === 'F003'), { status: 'planned', oracleAttempts: 0, lastFailure: undefined });
writeFileSync(join(dir, 'features.json'), `${JSON.stringify(answered, null, 2)}\n`); sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'questions: F003 back to planned']);
const before2 = plannerCalls();
const plan2 = sh('node', ['factory/loop.mjs', 'plan'], { env });
const after = ledger();
check('a plan with only planned features finishes them without calling the planner', plan2.status === 0 && plannerCalls() === before2 && after.F003.status === 'todo' && Object.keys(after.F003.oracle).length === 1, plan2.stdout);
check('every test was proven red before any work', events('oracle').filter((e) => /red first/.test(e.detail)).length === 4);
check('every feature carries its requirement and key from the PRD', Object.values(after).every((f) => /^R-00\d$/.test(f.requirement) && f.key === `selftest.files.r${f.requirement.slice(-1)}`));

// ---- 3. build: the ladder, the rails, continuation, artifacts and trailers
console.log('\nbuild');
const build = sh('node', ['factory/loop.mjs', 'build'], { env: { ...env, FAKE_MAXTURNS: 'F003' } });
const features = ledger();
const questions = JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf8')).questions;
const forF = (id) => questions.filter((q) => q.feature === id);
check('build exits 4: finished, with a blocked feature waiting on a person', build.status === 4, `exit ${build.status}\n${build.stdout}\n${build.stderr}`);
check('build says what it is doing: attempt lines and one line per gate stage', /build F001 · attempt 1 of 3/.test(build.stdout) && /gate spec\s+RED/.test(build.stdout) && /gate tooling\s+ok/.test(build.stdout), build.stdout);
check('F001 fails, receives the reason, then passes (feedback reaches the fixer)', features.F001.status === 'passing' && features.F001.attempts === 2);
check('F002 attempt 1: a weakened test is caught, restored, and classed as a rules failure', gates('F002')[0]?.detail === 'rails (rules)' && /readFileSync/.test(readFileSync(join(dir, 'spec/F002.test.mjs'), 'utf8')));
check('F002 attempt 2: a forged ledger is discarded', gates('F002')[1]?.detail === 'rails (rules)' && features.F002.status !== 'passing');
check('F002 ends blocked, with one typed question that has a default', features.F002.status === 'blocked' && forF('F002').length === 1 && forF('F002')[0].type === 'preference' && !!forF('F002')[0].default && forF('F002')[0].answer === null);
check('a question asked during a build is not mistaken for tampering, and is recorded once', gates('F001').every((g) => g.detail !== 'rails (rules)') && forF('F001').length === 1);
check('F003 ran out of turns, was continued once, and passed on that continuation', events('continuation').some((e) => e.feature === 'F003') && features.F003.status === 'passing' && features.F003.attempts === 1);
check('F003 still runs after F002 blocks (a blocked feature blocks nothing else)', features.F003.status === 'passing');
check('F004 environment failure is routed to repair, not retried', gates('F004')[0]?.detail === 'tooling (environment)' && gates('F004')[1]?.phase === 'repair' && features.F004.status === 'passing');
check('an agent saying "everything is perfect" changed nothing', features.F002.status === 'blocked');
check('each passing feature is its own commit', sh('git', ['log', '--oneline']).stdout.split('\n').filter((l) => /feat\(F00[134]\)/.test(l)).length === 3);
check('every gate writes an artifact with one step per stage, cited by runId', gates('F004').every((g) => g.runId && existsSync(join(dir, 'factory/state/results', g.runId, 'result.json'))) && JSON.parse(readFileSync(join(dir, 'factory/state/results', gates('F004').at(-1).runId, 'result.json'), 'utf8')).steps.map((s) => s.id).join(',') === 'tooling,spec');
const body = sh('git', ['log', '-1', '--format=%B', '--grep=^feat(F001)']).stdout;
check('a passing commit carries Feature, Requirement, Key and Gate trailers', ['Feature: F001', 'Requirement: R-001', 'Key: selftest.files.r1', 'Gate: '].every((t) => body.includes(t)), body);
const status = sh('node', ['factory/loop.mjs', 'status']).stdout;
check('status prints the inbox first and a reading per requirement', status.indexOf('questions waiting') < status.indexOf('features:') && /R-001\s+met/.test(status) && /R-002\s+unmet · blocked/.test(status), status);

console.log('\ntrace');
const t1 = sh('node', ['factory/loop.mjs', 'trace', 'R-001']);
check('trace joins requirement -> feature -> tests -> commit -> gate artifact (exit 0)', t1.status === 0 && ['R-001', 'F001', 'spec/F001.test.mjs', '→ commit', 'spec=pass'].every((t) => t1.stdout.includes(t)), t1.stdout);
const t2 = sh('node', ['factory/loop.mjs', 'trace', 'F002']);
check('trace prints a gap for a blocked feature (exit 3) and never fills it in', t2.status === 3 && /✗ no commit/.test(t2.stdout), t2.stdout);
check('trace resolves a key and a sha, and exits 2 for nothing', sh('node', ['factory/loop.mjs', 'trace', 'selftest.files.r1']).status === 0 && sh('node', ['factory/loop.mjs', 'trace', sh('git', ['log', '-1', '--format=%h', '--grep=^feat(F001)']).stdout.trim()]).status === 0 && sh('node', ['factory/loop.mjs', 'trace', 'R-999']).status === 2);

// ---- 4. a PRD change re-derives only its own branch; an over-proposal for a covered requirement is ignored
console.log('\nchange');
writeFileSync(join(dir, 'PRD.md'), prdText.replace('  - the file for R-003 says done\n', '  - the file for R-003 says done\n  - and it says so twice\n'));
const stale = sh('node', ['factory/loop.mjs', 'build'], { env });
check('build refuses while SPEC.md is behind the PRD', stale.status === 64 && /spec-stale/.test(stale.stderr), stale.stderr);
sh('node', ['factory/prd.mjs', 'spec']); sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'prd: change R-003']);
const plan3 = sh('node', ['factory/loop.mjs', 'plan'], { env: { ...env, FAKE_OVERPROPOSE: '1' } });
const changed = JSON.parse(readFileSync(join(dir, 'features.json'), 'utf8')).features;
const fresh = changed.find((f) => f.requirement === 'R-003' && f.status !== 'superseded');
check('only the changed requirement is re-derived', plan3.status === 0 && changed.find((f) => f.id === 'F003').status === 'superseded' && !existsSync(join(dir, 'spec/F003.test.mjs')) && fresh?.status === 'todo' && changed.find((f) => f.id === 'F001').status === 'passing' && JSON.stringify(changed.find((f) => f.id === 'F001').oracle) === JSON.stringify(features.F001.oracle), plan3.stdout);
check('the planner was asked about that one requirement only', /turning 1 requirement|splitting 1 requirement/.test(plan3.stdout));
check('proposals for an already-covered requirement are ignored, with a log line', events('plan-already-covered').some((e) => e.detail === 'R-001') && changed.filter((f) => f.requirement === 'R-001' && f.status !== 'superseded').length === 1);

// ---- 5. stream mode and the rails hook
console.log('\nstream mode');
const printed = []; const original = console.log; console.log = (line) => printed.push(line);
process.env.FACTORY_AGENT_CMD = env.FACTORY_AGENT_CMD;
const streamed = await runAgent({ phase: 'build', prompt: 'Feature F009: x', cwd: dir, config: { ...config, agent: { ...config.agent, progress: 'stream' } } });
console.log = original;
check('stream mode prints each tool call and still returns the structured result', streamed.ok && streamed.data.summary && printed.some((l) => l.includes('· Write src/example.ts')), JSON.stringify(streamed));

console.log('\nrails hook');
const hook = (phase, file) => spawnSync('node', [join(root, '.claude/hooks/rails.mjs')], { input: JSON.stringify({ cwd: dir, tool_input: { file_path: file } }), encoding: 'utf8', env: { ...process.env, FACTORY_PHASE: phase } });
check('build phase cannot edit a test', hook('build', 'spec/F001.test.tsx').status === 2);
check('build phase cannot edit the machinery, the PRD or the SPEC', hook('build', 'factory/loop.mjs').status === 2 && hook('repair', '.claude/settings.json').status === 2 && hook('build', 'PRD.md').status === 2 && hook('build', 'SPEC.md').status === 2);
check('build phase can edit product code', hook('build', 'src/pantry.ts').status === 0 && hook('build', 'app/index.tsx').status === 0);
check('oracle phase writes tests only', hook('oracle', 'spec/F009-x.test.tsx').status === 0 && hook('oracle', 'src/pantry.ts').status === 2);
check('your own sessions can edit the machinery and the PRD', hook('', 'factory/loop.mjs').status === 0 && hook('', 'PRD.md').status === 0);
check('secrets are denied in every phase', hook('', '.env.local').status === 2 && hook('build', 'keys/AuthKey.p8').status === 2);
check('an unreadable payload fails closed', spawnSync('node', [join(root, '.claude/hooks/rails.mjs')], { input: 'not json', encoding: 'utf8' }).status === 2);
check('Terraform state and variables are denied in every phase', ['', 'plan', 'oracle', 'build', 'repair'].every((p) => ['infra/terraform.tfstate', 'infra/terraform.tfstate.backup', 'infra/prod.tfvars', 'infra/prod.tfvars.json'].every((f) => hook(p, f).status === 2)));
check('a build can write infra/ but not the infra policy', hook('build', 'infra/main.tf.json').status === 0 && hook('build', 'factory/infra-policy.json').status === 2);

// ---- 6. infrastructure: everything in infra/ scales to zero, and no agent holds AWS credentials
console.log('\ninfrastructure');
const record = join(dir, 'factory/state/fake-env.json');
Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'fake', AWS_PROFILE: 'fake', FAKE_RECORD_ENV: record });
await runAgent({ phase: 'build', prompt: 'Feature F009: x', cwd: dir, config });
for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'FAKE_RECORD_ENV']) delete process.env[k];
const received = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {};
check('no AWS credential reaches an agent: only the three variables the runner sets', Object.keys(received).filter((k) => k.startsWith('AWS_')).sort().join(',') === 'AWS_CONFIG_FILE,AWS_EC2_METADATA_DISABLED,AWS_SHARED_CREDENTIALS_FILE' && received.AWS_SHARED_CREDENTIALS_FILE === '/dev/null' && received.FACTORY_PHASE === 'build', JSON.stringify(received));

const policy = JSON.parse(readFileSync(join(root, 'factory/infra-policy.json'), 'utf8'));
const cases = mkdtempSync(join(tmpdir(), 'factory-infra-'));
let caseNo = 0;
const infra = (files, { exceptions = [], args = ['check'] } = {}) => {
  const at = join(cases, String(caseNo += 1));
  mkdirSync(join(at, 'factory'), { recursive: true });
  writeFileSync(join(at, 'factory/infra-policy.json'), JSON.stringify({ ...policy, exceptions }));
  for (const [file, content] of Object.entries(files)) { mkdirSync(dirname(join(at, file)), { recursive: true }); writeFileSync(join(at, file), typeof content === 'string' ? content : JSON.stringify(content)); }
  const run = spawnSync('node', [join(dir, 'factory/infra.mjs'), ...args], { cwd: at, encoding: 'utf8' });
  return { ...run, codes: [...(run.stdout ?? '').matchAll(/^REFUSED (\S+)/gm)].map((m) => m[1]) };
};
// one type from every allowed area; the lifecycle names its bucket by reference, the log group by literal
const green = () => ({ resource: {
  aws_lambda_function: { api: { function_name: 'selftest-api', role: '${aws_iam_role.api.arn}', handler: 'index.handler', runtime: 'nodejs22.x', filename: 'api.zip' } },
  aws_cloudwatch_log_group: { api: { name: '/aws/lambda/selftest-api', retention_in_days: 14 } },
  aws_apigatewayv2_api: { http: { name: 'selftest', protocol_type: 'HTTP' } },
  aws_api_gateway_rest_api: { rest: { name: 'selftest' } },
  aws_api_gateway_stage: { rest: { rest_api_id: '${aws_api_gateway_rest_api.rest.id}', deployment_id: 'd', stage_name: 'live', cache_cluster_enabled: false } },
  aws_dynamodb_table: { items: { name: 'items', hash_key: 'id', billing_mode: 'PAY_PER_REQUEST', attribute: [{ name: 'id', type: 'S' }] } },
  aws_s3_bucket: { assets: { bucket: 'selftest-assets' } },
  aws_s3_bucket_lifecycle_configuration: { assets: { bucket: '${aws_s3_bucket.assets.id}', rule: [{ id: 'expire', status: 'Enabled', expiration: { days: 30 } }] } },
  aws_cloudfront_distribution: { site: { enabled: true, viewer_certificate: { acm_certificate_arn: '${aws_acm_certificate.site.arn}', ssl_support_method: 'sni-only' } } },
  aws_acm_certificate: { site: { domain_name: 'example.com', validation_method: 'DNS' } },
  aws_cognito_user_pool: { users: { name: 'selftest' } },
  aws_sqs_queue: { jobs: { name: 'jobs' } },
  aws_appsync_graphql_api: { gql: { name: 'selftest', authentication_type: 'API_KEY' } },
  aws_iam_role: { api: { name: 'selftest-api', assume_role_policy: '{}' } },
  aws_ssm_parameter: { key: { name: '/selftest/key', type: 'SecureString', value: 'x', tier: 'Standard' } },
  aws_s3vectors_vector_bucket: { kb: { vector_bucket_name: 'selftest-kb' } },
  aws_bedrockagent_knowledge_base: { kb: { name: 'selftest', role_arn: '${aws_iam_role.api.arn}', knowledge_base_configuration: { type: 'VECTOR' }, storage_configuration: { type: 'S3_VECTORS' } } },
} });
const mutate = (change) => { const doc = green(); change(doc.resource, doc); return { 'infra/main.tf.json': doc }; };
const only = (run, code) => run.status === 1 && run.codes.length > 0 && run.codes.every((c) => c === code);
const secret = { aws_secretsmanager_secret: { api: { name: 'api' } } };
const exception = (address) => ({ address, reason: 'a third-party key the owner rotates', monthlyUsd: 0.4, approved: 'owner 2026-09-23' });

const clean = infra(mutate(() => {}));
check('infra green control: one type from every allowed area passes', clean.status === 0 && clean.codes.length === 0, clean.stdout + clean.stderr);
const refusedCases = [
  ['a NAT gateway', 'infra-always-on', (r) => { r.aws_nat_gateway = { main: { subnet_id: 's' } }; }],
  ['a DynamoDB table with PROVISIONED billing', 'infra-attribute', (r) => { r.aws_dynamodb_table.items.billing_mode = 'PROVISIONED'; }],
  ['billing_mode set to ${var.mode}', 'infra-not-literal', (r) => { r.aws_dynamodb_table.items.billing_mode = '${var.mode}'; }],
  ['Lambda provisioned concurrency', 'infra-always-on', (r) => { r.aws_lambda_provisioned_concurrency_config = { api: { function_name: 'selftest-api', qualifier: 'live', provisioned_concurrent_executions: 1 } }; }],
  ['a Lambda with vpc_config', 'infra-attribute', (r) => { r.aws_lambda_function.api.vpc_config = { subnet_ids: ['s'], security_group_ids: ['g'] }; }],
  ['a Lambda with no log group', 'infra-no-log-group', (r) => { delete r.aws_cloudwatch_log_group; }],
  ['log retention of 0', 'infra-log-retention', (r) => { r.aws_cloudwatch_log_group.api.retention_in_days = 0; }],
  ['a bucket with no lifecycle configuration', 'infra-no-lifecycle', (r) => { delete r.aws_s3_bucket_lifecycle_configuration; }],
  ['a REST stage with caching on', 'infra-attribute', (r) => { r.aws_api_gateway_stage.rest.cache_cluster_enabled = true; }],
  ['CloudFront with vip', 'infra-attribute', (r) => { r.aws_cloudfront_distribution.site.viewer_certificate.ssl_support_method = 'vip'; }],
  ['Bedrock provisioned throughput', 'infra-always-on', (r) => { r.aws_bedrock_provisioned_model_throughput = { kb: { provisioned_model_name: 'p', model_arn: 'm', model_units: 1 } }; }],
  ['a knowledge base on OpenSearch Serverless', 'infra-attribute', (r) => { r.aws_bedrockagent_knowledge_base.kb.storage_configuration = { type: 'OPENSEARCH_SERVERLESS', opensearch_serverless_configuration: { collection_arn: 'c', vector_index_name: 'v' } }; }],
  ['a module block', 'infra-module', (r, doc) => { doc.module = { net: { source: './net' } }; }],
  ['an unknown type', 'infra-type-not-allowed', (r) => { r.aws_gamelift_fleet = { f: { name: 'f' } }; }],
  ['a Secrets Manager secret without an exception', 'infra-fixed-charge', (r) => { Object.assign(r, secret); }],
];
for (const [what, code, change] of refusedCases) { const run = infra(mutate(change)); check(`infra refuses ${what} (${code})`, only(run, code), run.stdout + run.stderr); }
const hcl = infra({ ...mutate(() => {}), 'infra/extra.tf': 'resource "aws_nat_gateway" "hidden" {}\n' });
check('infra refuses a .tf file (infra-hcl-present)', only(hcl, 'infra-hcl-present'), hcl.stdout + hcl.stderr);
const unparsable = infra({ 'infra/main.tf.json': '{ "resource": ' });
check('infra refuses a .tf.json it cannot parse (infra-parse)', only(unparsable, 'infra-parse'), unparsable.stdout + unparsable.stderr);
const excepted = infra(mutate((r) => Object.assign(r, secret)), { exceptions: [exception('aws_secretsmanager_secret.api')] });
check('the same secret with a valid exception passes, and the monthly total is printed', excepted.status === 0 && excepted.stdout.includes('$0.40'), excepted.stdout + excepted.stderr);
const staleRun = infra(mutate(() => {}), { exceptions: [exception('aws_secretsmanager_secret.api')] });
check('infra refuses a stale exception (infra-exception-stale)', only(staleRun, 'infra-exception-stale'), staleRun.stdout + staleRun.stderr);
const natException = infra(mutate((r) => { r.aws_nat_gateway = { main: { subnet_id: 's' } }; }), { exceptions: [exception('aws_nat_gateway.main')] });
check('an exception cannot allow a NAT gateway (infra-exception-invalid)', natException.status === 1 && /REFUSED infra-exception-invalid · aws_nat_gateway\.main · an exception can never allow/.test(natException.stdout) && natException.codes.includes('infra-always-on'), natException.stdout + natException.stderr);
const none = infra({});
check('with no infra/, check says so and exits 0', none.status === 0 && none.stdout.includes('no infra/: nothing to check'), none.stdout + none.stderr);
const planned = { planned_values: { root_module: { resources: [{ address: 'aws_sqs_queue.jobs', mode: 'managed', type: 'aws_sqs_queue', name: 'jobs', values: { name: 'jobs' } }], child_modules: [{ address: 'module.net', resources: [{ address: 'module.net.aws_nat_gateway.this', mode: 'managed', type: 'aws_nat_gateway', name: 'this', values: {} }] }] } } };
const planRun = infra({ 'plan.json': planned }, { args: ['plan', 'plan.json'] });
check('plan mode refuses a NAT gateway inside a child module', planRun.status === 1 && planRun.stdout.includes('REFUSED infra-always-on · module.net.aws_nat_gateway.this'), planRun.stdout + planRun.stderr);
rmSync(cases, { recursive: true, force: true });

// through the loop: the refusal is the builder's instruction on the next attempt
const target = fresh?.id ?? 'F999';
writeFileSync(join(dir, 'factory/config.json'), JSON.stringify({ ...config, gate: [config.gate[0], { name: 'infra-policy', cmd: 'node factory/infra.mjs check' }, config.gate[1]] }, null, 2));
sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'gate: add infra-policy']);
sh('node', ['factory/loop.mjs', 'build'], { env: { ...env, FAKE_INFRA: target } });
const infraGates = gates(target);
const infraPrompts = existsSync(join(dir, 'factory/state/fake-prompts.log')) ? readFileSync(join(dir, 'factory/state/fake-prompts.log'), 'utf8').split('\n=====\n') : [];
check('a NAT gateway written by a build fails the gate at infra-policy, classed as work', infraGates[0]?.detail === 'infra-policy (work)', JSON.stringify(infraGates));
check('the next attempt removes it and passes', infraGates[1]?.ok === true && ledger()[target]?.status === 'passing', JSON.stringify(infraGates));
check('the refusal code reaches the next attempt\'s prompt', (infraPrompts[1] ?? '').includes('infra-always-on'), infraPrompts[1] ?? '(no second prompt)');

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
