#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { detectProvider } from './llm.js';
import { runAnalysis, normalizeRange, todayLocal } from './pipeline.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1'; // local only: this server can trigger LLM usage
const llm = detectProvider();

const jobs = new Map();
let activeJob = null; // one analysis at a time keeps LLM/network usage bounded

function startJob(range) {
  const job = { id: crypto.randomUUID(), status: 'running', progress: [], done: 0, total: 0, startedAt: Date.now() };
  jobs.set(job.id, job);
  activeJob = job;
  runAnalysis(range, {
    llm,
    onProgress: (p) => {
      job.progress.push({ t: Date.now(), stage: p.stage, message: p.message });
      if (p.total) { job.done = p.done; job.total = p.total; }
    },
  }).then(({ result }) => { job.status = 'done'; job.result = result; })
    .catch((e) => { job.status = 'error'; job.error = e.message; })
    .finally(() => { activeJob = null; });
  return job;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 10_000) { reject(new Error('body too large')); req.destroy(); } });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { today: todayLocal(), provider: llm.name, activeId: activeJob?.id ?? null });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      if (activeJob) return send(res, 409, { error: 'An analysis is already running', id: activeJob.id });
      let range;
      try {
        const b = JSON.parse((await readBody(req)) || '{}');
        range = normalizeRange({ from: b.from, to: b.to });
      } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 202, { id: startJob(range).id });
    }
    const m = url.pathname.match(/^\/api\/jobs\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: 'Unknown job' });
      const { id, status, progress, done, total, result, error, startedAt } = job;
      return send(res, 200, { id, status, progress, done, total, result, error, elapsedMs: Date.now() - startedAt });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MarketTales AI UI: http://localhost:${PORT}  (reasoning provider: ${llm.name})`);
});
