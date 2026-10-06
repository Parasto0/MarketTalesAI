const DIRS = ['Higher', 'Lower', 'Unclear'];
const CONFS = ['Low', 'Medium', 'High'];
const HORIZONS = ['d1', 'w1', 'm1'];
const TAGS = ['Earnings', 'Guidance', 'Analyst', 'Sector', 'Macro', 'Product', 'Deal', 'Regulatory', 'Technical', 'Unknown'];
const EVIDENCE = ['Weak', 'Moderate', 'Strong'];

export const fmt = (n, d = 2) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`);

export function buildPrompt(stock, news, asOf) {
  const facts = [
    `Ticker: ${stock.ticker} (${stock.name})`,
    `Period: close of ${stock.prevDate} to close of ${stock.sessionDate} (${stock.sessions} trading session${stock.sessions === 1 ? '' : 's'})`,
    `Close ${stock.close.toFixed(2)} ${stock.currency} vs ${stock.prevClose.toFixed(2)} => move over the period ${fmt(stock.changePct)}`,
    `5-session return: ${fmt(stock.ret5dPct)}; ~1-month return: ${fmt(stock.ret1mPct)}`,
    `Average volume in period vs prior 20 sessions: ${stock.volumeRatio == null ? 'n/a' : stock.volumeRatio.toFixed(2) + 'x'}`,
  ].join('\n');

  const items = news.length
    ? news.map((n, i) => {
        const head = `[${i + 1}] ${n.published?.slice(0, 10) ?? 'undated'} | ${n.publisher || 'unknown'} | ${n.title}`;
        if (!n.body) return head;
        return `${head}\n    ${n.bodyKind === 'full' ? 'ARTICLE TEXT (truncated)' : 'ARTICLE SUMMARY'}: ${n.body}`;
      }).join('\n')
    : '(no recent news found)';

  return `You are the analysis step of a market-research agent. The analysis date is ${asOf}; forecasts are made as of that date. Use ONLY the market data and news below. Do not use outside knowledge of recent events, and never invent facts, numbers, catalysts or sources.

VERIFIED MARKET DATA (computed from price data, treat as fact):
${facts}

NEWS (numbered; items with ARTICLE TEXT/SUMMARY were read, the others are headline-only):
${items}

Produce a decision-support brief: what is driving the stock, a directional view for three horizons, and the scenarios that could change it.

Rules:
- "why": 2 to 5 bullets, each ONE idea of at most 22 words, in plain language, most important first. The first bullet is the main catalyst. Say "Likely ..." when the cause is inferred rather than stated. Each bullet carries "src": the news numbers it relies on (may be empty for bullets based only on market data). If no catalyst can be identified, say so in one bullet and use the others for context (sector tone, momentum, volume).
- "catalyst_short": at most 10 words. "reason_tag": exactly one of ${TAGS.join(', ')}.
- "outlook" for d1 (next trading day), w1 (next week), m1 (next month): "direction" is exactly Higher, Lower or Unclear; "confidence" is exactly Low, Medium or High; "why" is at most 18 words.
  * Form a directional view whenever the evidence reasonably supports one. Weigh the nature of the catalyst (earnings, guidance and analyst revisions tend to drift; one-off headlines and no-catalyst spikes tend to fade), momentum (5-day and 1-month returns), volume, whether the move reverses or extends the prior trend, and any scheduled events mentioned in the articles.
  * Use "Unclear" ONLY when the evidence genuinely conflicts or is absent; then confidence must be Low. Do not use it as a default.
  * Confidence: High = specific, corroborated catalyst AND supportive context; Medium = plausible catalyst with some support; Low = thin or speculative but still directional.
  * Horizons may differ (e.g. a pullback next day inside a higher month). Do not copy one answer to all three without reason.
- "could_change": 2 to 4 scenarios, each {"kind":"upside"|"risk","text": at most 22 words}. "upside" = something that could push the price higher; "risk" = something that could push it lower. Include at least one of each. Describe scenarios and potential opportunities/risks only: no buy/sell/hold advice, no price targets, no promises of certainty.
- "evidence": exactly Weak, Moderate or Strong, reflecting how well the sources explain the move.
- "source_ids": the news numbers you relied on overall.

Respond with ONLY a JSON object, no markdown fences:
{"why":[{"text":"","src":[]}],"catalyst_short":"","reason_tag":"","outlook":{"d1":{"direction":"","confidence":"","why":""},"w1":{"direction":"","confidence":"","why":""},"m1":{"direction":"","confidence":"","why":""}},"could_change":[{"kind":"","text":""}],"evidence":"","source_ids":[]}`;
}

function extractJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(s, e + 1));
}

const str = (v, name, max = 300) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`missing field ${name}`);
  return v.trim().slice(0, max);
};

// Validate and normalise model output; source URLs are restricted to news we actually supplied.
export function validate(raw, news) {
  const outlook = {};
  for (const h of HORIZONS) {
    const o = raw.outlook?.[h];
    if (!o || !DIRS.includes(o.direction) || !CONFS.includes(o.confidence)) throw new Error(`invalid outlook ${h}`);
    outlook[h] = {
      direction: o.direction,
      confidence: o.direction === 'Unclear' ? 'Low' : o.confidence,
      why: typeof o.why === 'string' ? o.why.trim().slice(0, 200) : '',
    };
  }
  if (!Array.isArray(raw.why) || !raw.why.length) throw new Error('missing why bullets');
  if (!Array.isArray(raw.could_change) || !raw.could_change.length) throw new Error('missing could_change');

  const valid = (i) => Number.isInteger(i) && i >= 1 && i <= news.length;
  const ids = [];
  const touch = (i) => { if (!ids.includes(i)) ids.push(i); return ids.indexOf(i) + 1; }; // 1-based index into `sources`
  const why = raw.why.slice(0, 5).map((b) => ({
    text: str(typeof b === 'string' ? b : b?.text, 'why.text', 260),
    src: [...new Set((Array.isArray(b?.src) ? b.src : []).map(Number))].filter(valid).map(touch),
  }));
  (Array.isArray(raw.source_ids) ? raw.source_ids : []).map(Number).filter(valid).forEach(touch);

  const could_change = raw.could_change.slice(0, 4).map((c) => ({
    kind: c?.kind === 'upside' ? 'upside' : 'risk',
    text: str(c?.text, 'could_change.text', 260),
  }));

  return {
    why,
    catalyst_short: str(raw.catalyst_short, 'catalyst_short', 90),
    reason_tag: TAGS.includes(raw.reason_tag) ? raw.reason_tag : 'Unknown',
    outlook,
    could_change,
    evidence: EVIDENCE.includes(raw.evidence) ? raw.evidence : 'Weak',
    sources: ids.map((i) => {
      const n = news[i - 1];
      return { title: n.title, publisher: n.publisher, url: n.url, published: n.published, read: !!n.body };
    }),
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
    why: [{ text: `Automated analysis failed (${lastErr.message}); catalyst not identified.`, src: [] }],
    catalyst_short: 'Analysis unavailable',
    reason_tag: 'Unknown',
    outlook: Object.fromEntries(HORIZONS.map((h) => [h, { direction: 'Unclear', confidence: 'Low', why: '' }])),
    could_change: [],
    evidence: 'Weak',
    sources: news.slice(0, 3).map((n) => ({ title: n.title, publisher: n.publisher, url: n.url, published: n.published, read: false })),
    mode: 'degraded',
  };
}

// One short call that turns the ten analysed movers into a headline + up to 3 themes. Returns null on failure.
export async function summarizeMarket(cards, llm, asOf) {
  const lines = cards.map((c) => `${c.ticker} ${fmt(c.changePct)} [${c.analysis.reason_tag}] ${c.analysis.catalyst_short}`).join('\n');
  const prompt = `Analysis date ${asOf}. Below are the 5 biggest rising and 5 biggest falling large-cap US stocks with their identified catalyst category and short catalyst. Use ONLY this data.

${lines}

Write a quick morning overview: "headline" is ONE plain sentence of at most 22 words describing the main story across these movers (do not invent causes beyond the catalysts given); "themes" is up to 3 short phrases of at most 8 words each naming common drivers or sectors (omit rather than guess). No investment advice.
Respond with ONLY JSON: {"headline":"","themes":[""]}`;
  try {
    const j = extractJson(await llm.complete(prompt));
    return {
      headline: str(j.headline, 'headline', 220),
      themes: (Array.isArray(j.themes) ? j.themes : []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 3).map((t) => t.trim().slice(0, 70)),
    };
  } catch {
    return null;
  }
}
