import { spawn } from 'node:child_process';
import os from 'node:os';

const MODEL = process.env.MARKETTALES_MODEL || 'claude-sonnet-5-5';

async function viaApi(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j.content.map(c => c.text || '').join('');
}

// Uses the locally installed, already-authenticated Claude Code CLI in headless mode, with all tools disabled
// (pure text-in/text-out) and run from a temp dir so no project context leaks in.
function viaCli(prompt) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'text'], {
      cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('claude CLI timed out')); }, 180000);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`claude CLI exit ${code}: ${(err || out).slice(0, 300)}`));
    });
    p.stdin.end(prompt);
  });
}

export function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: 'anthropic-api', complete: viaApi };
  return { name: 'claude-cli', complete: viaCli };
}
