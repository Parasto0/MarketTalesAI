#!/usr/bin/env node
import { detectProvider } from './llm.js';
import { runAnalysis, todayLocal } from './pipeline.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const request = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).join(' ')
  || 'Analyze today\'s top market movers.';
const log = (m) => console.error(`[markettales] ${m}`);

if (!/market movers/i.test(request)) {
  console.error('This MVP supports one request: "Analyze today\'s top market movers."');
  process.exit(2);
}

// --date for a single day; --from/--to for a range (UI offers a month picker on top of this).
const to = flag('to') || flag('date') || todayLocal();
const from = flag('from') || to;
const llm = detectProvider();
log(`request: ${request} (${from === to ? to : `${from} → ${to}`}), reasoning provider: ${llm.name}`);

try {
  const { markdown, file } = await runAnalysis({ from, to }, {
    llm,
    onProgress: (p) => log(p.total ? `[${p.done}/${p.total}] ${p.message}` : p.message),
  });
  log(`report written: ${file}`);
  console.log(markdown);
} catch (e) {
  console.error(`[markettales] failed: ${e.message}`);
  process.exit(1);
}
