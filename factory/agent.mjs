// One fresh, headless Claude Code session per call. The only thing read back is
// schema-constrained JSON (`structured_output`) and the cost. Prose is ignored.
// Docs: https://code.claude.com/docs/en/headless
import { spawn } from 'node:child_process';

const question = {
  type: 'object',
  required: ['type', 'question', 'default'],
  properties: {
    // A question only a person can answer. There is no type for "how do I fix this".
    type: { enum: ['fact', 'preference', 'credential', 'legal'] },
    question: { type: 'string' },
    default: { type: 'string', description: 'What you will proceed on if nobody answers.' },
    blocking: { type: 'boolean', description: 'True only when proceeding on the default cannot be undone.' },
  },
};
const feature = {
  type: 'object',
  required: ['title', 'requirement', 'acceptance'],
  properties: {
    title: { type: 'string' },
    requirement: { type: 'string', pattern: '^R-[0-9]{3}$', description: 'The PRD requirement this feature delivers.' },
    acceptance: { type: 'array', minItems: 1, items: { type: 'string' } },
    needsDevice: { type: 'boolean' },
  },
};
const questions = { type: 'array', items: question };

export const SCHEMAS = {
  plan: { type: 'object', required: ['features'], properties: { features: { type: 'array', minItems: 1, items: feature }, questions } },
  oracle: { type: 'object', required: ['tests'], properties: { tests: { type: 'array', minItems: 1, items: { type: 'string' } }, flows: { type: 'array', items: { type: 'string' } }, questions } },
  build: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, questions } },
  repair: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, questions } },
  replan: {
    type: 'object',
    required: ['action', 'reason'],
    properties: { action: { enum: ['split', 'block'] }, reason: { type: 'string' }, features: { type: 'array', items: feature }, question },
  },
};

// Agents never hold AWS credentials: every AWS_* variable is dropped, and the SDKs' credential files
// and instance metadata are switched off. FACTORY_PHASE is read by .claude/hooks/rails.mjs.
export const agentEnv = (phase, env = process.env) => ({
  ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('AWS_'))),
  AWS_SHARED_CREDENTIALS_FILE: '/dev/null', AWS_CONFIG_FILE: '/dev/null', AWS_EC2_METADATA_DISABLED: 'true',
  FACTORY_PHASE: phase,
});

const brief = (input = {}) => String(input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.description ?? '').replace(/\s+/g, ' ').slice(0, 70);

/** Resolves to { ok, data, cost, seconds, reason, stderr }. Prints a heartbeat, and tool activity in stream mode. */
export function runAgent({ phase, prompt, config, cwd }) {
  const stream = config.agent.progress === 'stream';
  const [cmd, ...pre] = (process.env.FACTORY_AGENT_CMD || config.agent.cmd).split(' ');
  const args = [
    ...pre,
    '-p', prompt,
    '--output-format', stream ? 'stream-json' : 'json',
    ...(stream ? ['--verbose'] : []),
    '--json-schema', JSON.stringify(SCHEMAS[phase]),
    '--permission-mode', config.agent.permissionMode,
    '--max-turns', String(config.budget.maxTurns),
    ...(config.agent.models?.[phase] ? ['--model', config.agent.models[phase]] : []),
    ...(config.agent.extraFlags ?? []),
  ];
  return new Promise((resolve) => {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 1000);
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: agentEnv(phase) });
    let stdout = ''; let stderr = ''; let pending = ''; let result = null; let done = false;
    const beat = setInterval(() => console.log(`    … ${phase} still working (${seconds()}s)`), Number(process.env.FACTORY_HEARTBEAT_MS) || 30000);
    const kill = setTimeout(() => child.kill('SIGTERM'), 90 * 60 * 1000);
    const take = (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'result') result = message;
      if (message.type === 'assistant') for (const block of message.message?.content ?? []) if (block.type === 'tool_use') console.log(`    · ${block.name} ${brief(block.input)}`);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!stream) return;
      pending += chunk; const lines = pending.split('\n'); pending = lines.pop();
      lines.forEach(take);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const finish = (code, errorCode) => {
      if (done) return; done = true; clearInterval(beat); clearTimeout(kill);
      if (stream && pending.trim()) take(pending);
      let out = result;
      if (!stream) { try { out = JSON.parse(stdout); if (Array.isArray(out)) out = out.filter((m) => m?.type === 'result').pop() ?? null; } catch { out = null; } }
      const base = { seconds: seconds(), stderr: stderr.slice(-600) };
      if (!out) return resolve({ ok: false, data: null, cost: 0, reason: errorCode ?? 'agent-output-unparsable', ...base });
      const cost = Number(out.total_cost_usd) || 0;
      if (code !== 0 || out.is_error || (out.subtype && out.subtype !== 'success')) return resolve({ ok: false, data: null, cost, reason: out.subtype && out.subtype !== 'success' ? out.subtype : `agent-exit-${code}`, ...base });
      if (out.structured_output == null) return resolve({ ok: false, data: null, cost, reason: 'no-structured-output', ...base });
      return resolve({ ok: true, data: out.structured_output, cost, reason: null, ...base });
    };
    child.on('error', (error) => finish(null, error.code));
    child.on('close', (code) => finish(code));
  });
}
