# MarketTales AI (MVP)

Autonomous research agent: finds the 5 biggest bullish and 5 biggest bearish movers among ~110 large-cap US stocks, gathers recent headlines for each, and writes a concise directional-outlook report with sources.

```
node src/index.js "Analyze today's top market movers." [--date YYYY-MM-DD]
```

Output goes to stdout and `reports/market-movers-<date>.md` (+ raw `.json`). No dependencies; Node 20+.

## Pipeline
1. `market.js` – Yahoo Finance chart API (no key) -> daily move, 5d/1m return, volume ratio; ranks the universe (`universe.js`).
2. `news.js` – Yahoo search news + Google News RSS (no key); headlines only, last ~4 days.
3. `llm.js` / `analyze.js` – one analysis per stock. Uses `ANTHROPIC_API_KEY` (Messages API, model via `MARKETTALES_MODEL`) if set, otherwise the logged-in `claude` CLI in headless mode with tools disabled. Output is validated: cited sources must be supplied headlines; "Unclear" is forced to "Low" confidence; failures degrade to "Unclear — Low", never invented text.
4. `report.js` – deterministic markdown. Prices/moves are computed facts; catalysts/outlooks are labelled AI interpretation.

## Limitations
- Evidence is headlines only (article bodies are not read), so most outlooks will honestly be "Unclear — Low".
- Moves reflect the latest completed session in the data; the report states this if it differs from the requested date.
- Universe is a fixed list, so a small-cap or non-listed mover will not appear.
- Not investment advice; no trading functionality.
