import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIVERSE } from './universe.js';
import { findMovers } from './market.js';
import { fetchNews } from './news.js';
import { detectProvider } from './llm.js';
import { readTopArticles } from './articles.js';
import { analyzeStock, summarizeMarket } from './analyze.js';
import { computeMood, computeLean } from './overview.js';
import { renderReport } from './report.js';
import { mapLimit } from './http.js';

const REPORTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const todayLocal = () => new Date().toLocaleDateString('en-CA');

// Validates a request: { from, to } (single day when equal). Throws a user-readable Error.
export function normalizeRange({ from, to }) {
  to = to || from;
  from = from || to;
  for (const d of [from, to]) {
    if (!YMD.test(d || '') || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new Error(`Invalid date "${d}" (expected YYYY-MM-DD)`);
  }
  if (from > to) throw new Error('Start date must not be after end date');
  if (to > todayLocal()) throw new Error('End date is in the future');
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 366) throw new Error('Range is limited to 366 days');
  return { from, to };
}

// Runs the full research pipeline. `onProgress({ stage, message, done, total })` is optional.
export async function runAnalysis({ from, to }, { onProgress = () => {}, llm = detectProvider() } = {}) {
  ({ from, to } = normalizeRange({ from, to }));
  const label = from === to ? to : `${from} → ${to}`;
  const emit = (stage, message, done, total) => onProgress({ stage, message, done, total });

  emit('scan', `Scanning ${UNIVERSE.length} large-cap stocks for the biggest moves...`);
  const movers = await findMovers(UNIVERSE, { from, to });
  const picks = [...movers.bullish, ...movers.bearish];
  if (!picks.length) throw new Error(`No movers found for ${label} (market closed or no data)`);
  emit('scan', `Measured ${movers.scanned} stocks (${movers.baselineDate} → ${movers.sessionDate}); selected ${picks.map(s => s.ticker).join(', ')}`);

  let done = 0;
  emit('research', 'Researching news, reading articles and analysing each mover...', 0, picks.length);
  const analyzed = await mapLimit(picks, 5, async (stock) => {
    const news = await fetchNews(stock.ticker, stock.name, { from, to, direction: stock.changePct });
    const read = await readTopArticles(news, stock.sessionDate); // bodies of the few most relevant articles
    const a = await analyzeStock(stock, news, llm, to);
    emit('research', `${stock.ticker}: ${news.length} sources, ${read} read in full (${a.mode})`, ++done, picks.length);
    return { stock, news, a };
  });
  const failure = analyzed.find(x => x.error);
  if (failure) throw new Error(`Pipeline failure: ${failure.error}`);

  const nBull = movers.bullish.length;
  const bullish = analyzed.slice(0, nBull), bearish = analyzed.slice(nBull);
  const card = ({ stock, a }) => ({ ...stock, analysis: a });
  const cards = analyzed.map(card);

  emit('summary', 'Writing the market overview...');
  const story = await summarizeMarket(cards, llm, to);
  const overview = { mood: computeMood(movers.breadth), lean: computeLean(cards), story };

  const markdown = renderReport({ date: label, movers, provider: llm.name, bullish, bearish, overview });
  const result = {
    request: { from, to, label },
    sessionDate: movers.sessionDate,
    baselineDate: movers.baselineDate,
    sessionLive: movers.sessionLive,
    scanned: movers.scanned,
    failedTickers: movers.failed,
    provider: llm.name,
    generatedAt: new Date().toISOString(),
    overview,
    bullish: cards.slice(0, nBull),
    bearish: cards.slice(nBull),
  };

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const base = path.join(REPORTS_DIR, `market-movers-${from === to ? to : `${from}_to_${to}`}`);
  fs.writeFileSync(`${base}.md`, markdown, 'utf8');
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2), 'utf8');
  return { result, markdown, file: `${base}.md` };
}
