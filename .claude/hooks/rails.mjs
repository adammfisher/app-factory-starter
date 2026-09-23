#!/usr/bin/env node
// PreToolUse guard for Edit / Write / MultiEdit. The worker cannot edit its own rails.
// stdin: hook payload JSON · exit 0 allow · exit 2 deny (reason on stderr). Fails closed.
import { relative, resolve, sep } from 'node:path';

const deny = (why) => { process.stderr.write(`BLOCKED (rails): ${why}\n`); process.exit(2); };
const LOCKED_IN_LOOP = ['spec/', '.maestro/', 'factory/', '.claude/', 'features.json', 'questions.json', 'PRD.md', 'SPEC.md'];
const SECRET = /(^|\/)\.env(\..*)?$|\.(p8|p12|jks|keystore|mobileprovision|tfstate|tfstate\.backup|tfvars|tfvars\.json)$/;

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; }).on('end', () => {
  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch { deny('unreadable hook payload'); }
  const input = payload.tool_input ?? {};
  const target = input.file_path ?? input.path ?? '';
  if (!target) process.exit(0);
  const cwd = payload.cwd ?? process.cwd();
  const rel = relative(cwd, resolve(cwd, target)).split(sep).join('/');
  if (rel.startsWith('..')) deny(`${target} is outside the project`);
  if (SECRET.test(rel)) deny(`${rel} is a secret file`);

  const phase = process.env.FACTORY_PHASE ?? ''; // set by factory/agent.mjs; empty in your own sessions
  const under = (prefix) => rel === prefix || rel.startsWith(prefix);
  if (phase === 'oracle' && !(under('spec/') || under('.maestro/'))) deny('the oracle phase writes only spec/ and .maestro/');
  if (phase && phase !== 'oracle') {
    const hit = LOCKED_IN_LOOP.find(under);
    if (hit) deny(`${hit} is locked during the ${phase} phase`);
  }
  process.exit(0);
});
