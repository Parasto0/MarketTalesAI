#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIVERSE } from './universe.js';
import { findMovers } from './market.js';
import { fetchNews } from './news.js';
import { detectProvider } from './llm.js';
import { analyzeStock } from './analyze.js';
import { renderReport } from './report.js';
import { mapLimit } from './http.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const request = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')).join(' ')
  || 'Analyze today\'s top market movers.';
const date = flag('date') || new Date().toLocaleDateString('en-CA');
const log = (m) => console.error(`[markettales] ${m}`);

if (!/market movers/i.test(request)) {
  console.error('This MVP supports one request: "Analyze today\'s top market movers."');
  process.exit(2);
}

log(`request: ${request} (date ${date})`);
const llm = detectProvider();
log(`reasoning provider: ${llm.name}`);

log(`scanning ${UNIVERSE.length} large-cap stocks for the biggest daily moves...`);
const movers = await findMovers(UNIVERSE);
log(`session ${movers.sessionDate}: ${movers.scanned} stocks scanned${movers.failed.length ? `, ${movers.failed.length} failed (${movers.failed.join(', ')})` : ''}`);
if (movers.bullish.length < 5 || movers.bearish.length < 5) log(`warning: only ${movers.bullish.length} bullish / ${movers.bearish.length} bearish movers available`);

const picks = [...movers.bullish, ...movers.bearish];
log(`selected: +${movers.bullish.map(s => s.ticker).join(',')}  -${movers.bearish.map(s => s.ticker).join(',')}`);

log('researching news + analysing each stock...');
const analyzed = await mapLimit(picks, 5, async (stock) => {
  const news = await fetchNews(stock.ticker, stock.name);
  const a = await analyzeStock(stock, news, llm, date);
  log(`  ${stock.ticker}: ${news.length} headlines, ${a.mode}`);
  return { stock, news, a };
});
if (analyzed.some(x => x.error)) throw new Error(`pipeline failure: ${analyzed.find(x => x.error).error}`);

const nBull = movers.bullish.length;
const md = renderReport({
  date, movers, provider: llm.name,
  bullish: analyzed.slice(0, nBull),
  bearish: analyzed.slice(nBull),
});

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `market-movers-${date}.md`);
fs.writeFileSync(file, md, 'utf8');
fs.writeFileSync(file.replace(/\.md$/, '.json'), JSON.stringify({ date, movers, analyzed }, null, 2), 'utf8');
log(`report written: ${file}`);
console.log(md);
