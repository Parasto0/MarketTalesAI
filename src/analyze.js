const DIRS = ['Higher', 'Lower', 'Unclear'];
const CONFS = ['Low', 'Medium', 'High'];
const HORIZONS = ['d1', 'w1', 'm1'];

const fmt = (n, d = 2) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`);

export function buildPrompt(stock, news, asOf) {
  const facts = [
    `Ticker: ${stock.ticker} (${stock.name})`,
    `Session: ${stock.sessionDate} (previous session ${stock.prevDate})`,
    `Close ${stock.close.toFixed(2)} ${stock.currency} vs previous close ${stock.prevClose.toFixed(2)} => daily move ${fmt(stock.changePct)}`,
    `5-session return: ${fmt(stock.ret5dPct)}; ~1-month return: ${fmt(stock.ret1mPct)}`,
    `Volume vs 20-day average: ${stock.volumeRatio == null ? 'n/a' : stock.volumeRatio.toFixed(2) + 'x'}`,
  ].join('\n');
  const headlines = news.length
    ? news.map((n, i) => `[${i + 1}] ${n.published?.slice(0, 10) ?? 'undated'} | ${n.publisher || 'unknown'} | ${n.title}`).join('\n')
    : '(no recent headlines found)';

  return `You are the analysis step of a market-research agent. Today is ${asOf}. Use ONLY the facts and headlines below; do not use outside knowledge of recent events and never invent data, news, catalysts or sources.

VERIFIED MARKET DATA (computed from price data, treat as fact):
${facts}

RECENT HEADLINES (numbered; headlines only, article bodies were not read):
${headlines}

Task: explain the move and give a directional outlook.
Rules:
- "why": the most likely catalyst, citing evidence from the headlines. State clearly that it is interpretation when headlines do not explicitly explain the move. If the headlines do not support any catalyst, say the catalyst is not identified.
- "catalyst_short": <= 12 words, e.g. "Q3 earnings beat" or "No clear catalyst found".
- Outlook per horizon (d1 = next trading day, w1 = next week, m1 = next month): direction is exactly "Higher", "Lower" or "Unclear"; confidence is exactly "Low", "Medium" or "High". With insufficient evidence use "Unclear" with "Low". This is a probabilistic AI forecast, never a recommendation: no buy/sell advice, no price targets, no guarantees. Short horizons after big moves are inherently uncertain; avoid "High" unless evidence is exceptionally strong.
- "risks": 1-2 sentences on what could invalidate or change the outlook, including any contradicting evidence.
- "source_ids": numbers of the headlines you actually relied on (may be empty).

Respond with ONLY a JSON object, no markdown fences:
{"why":"","catalyst_short":"","outlook":{"d1":{"direction":"","confidence":""},"w1":{"direction":"","confidence":""},"m1":{"direction":"","confidence":""}},"risks":"","source_ids":[]}`;
}

function extractJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(s, e + 1));
}

// Validate and normalise model output; source URLs are restricted to headlines we actually supplied.
export function validate(raw, news) {
  const str = (v, name) => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`missing field ${name}`);
    return v.trim();
  };
  const outlook = {};
  for (const h of HORIZONS) {
    const o = raw.outlook?.[h];
    if (!o || !DIRS.includes(o.direction) || !CONFS.includes(o.confidence)) throw new Error(`invalid outlook ${h}`);
    outlook[h] = o.direction === 'Unclear' ? { direction: 'Unclear', confidence: 'Low' } : { direction: o.direction, confidence: o.confidence };
  }
  const ids = [...new Set((Array.isArray(raw.source_ids) ? raw.source_ids : []).map(Number))]
    .filter(i => Number.isInteger(i) && i >= 1 && i <= news.length);
  return {
    why: str(raw.why, 'why'),
    catalyst_short: str(raw.catalyst_short, 'catalyst_short'),
    outlook,
    risks: str(raw.risks, 'risks'),
    sources: ids.map(i => news[i - 1]),
  };
}

export async function analyzeStock(stock, news, llm, asOf) {
  const prompt = buildPrompt(stock, news, asOf);
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { ...validate(extractJson(await llm.complete(prompt)), news), mode: 'llm' };
    } catch (e) {
      lastErr = e;
    }
  }
  // Honest degraded result: never fabricate an explanation when analysis fails.
  return {
    why: `Automated analysis failed (${lastErr.message}); catalyst not identified.`,
    catalyst_short: 'Analysis unavailable',
    outlook: Object.fromEntries(HORIZONS.map(h => [h, { direction: 'Unclear', confidence: 'Low' }])),
    risks: 'No analysis available; see headlines below.',
    sources: news.slice(0, 3),
    mode: 'degraded',
  };
}

export { fmt };
