#!/usr/bin/env node
/**
 * Live Cloudflare Room Bot Runner (Node 24, zero external dependencies).
 * Drives N concurrent bots through /api/demo/check-in -> /start -> 10x /answers
 * WITHOUT posting to /api/demo/telemetry so human carrier reports stay clean.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const BASE_URL = (
  process.env.BASE_URL ||
  'https://baci-quiz-room-prototype.ogabassey-ai.workers.dev'
).replace(/\/$/, '');
const INVITE_CODE = (process.env.DEMO_INVITE_CODE || '').trim();
const BOT_COUNT = Number.parseInt(process.env.BOT_COUNT || '490', 10);
const ROOM_COUNT = Number.parseInt(process.env.ROOM_COUNT || '1', 10);
const RAMP_MS = Number.parseInt(process.env.RAMP_MS || '10000', 10);
const THINK_MS = Number.parseInt(process.env.THINK_MS || '1200', 10);
const TIMEOUT_MS = Number.parseInt(process.env.TIMEOUT_MS || '12000', 10);
const OUT_FILE = process.env.OUT_FILE || '';

if (!INVITE_CODE) {
  console.error('ERROR: DEMO_INVITE_CODE env var is required.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1)
  );
  return sorted[idx] ?? 0;
}

async function fetchJson(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    const ms = performance.now() - t0;
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, ms, json };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: performance.now() - t0,
      json: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

const stats = {
  checkInMs: [],
  startMs: [],
  answerMs: [],
  checkInErrors: 0,
  startErrors: 0,
  answerErrors: 0,
  answersSucceeded: 0,
  botsCompleted: 0,
  errorSamples: [],
};

function recordError(stage, botId, res) {
  if (stats.errorSamples.length < 10) {
    stats.errorSamples.push({
      stage,
      botId,
      status: res.status,
      error: res.json?.error || res.json?.code || 'unknown',
    });
  }
}

async function runBot(botIndex) {
  const staggerMs =
    BOT_COUNT > 1 ? Math.floor((botIndex / BOT_COUNT) * RAMP_MS) : 0;
  if (staggerMs > 0) await sleep(staggerMs);

  const roomShard = botIndex % Math.max(1, ROOM_COUNT);
  const roomId = `room-${String(roomShard).padStart(4, '0')}`;

  const checkIn = await fetchJson(`${BASE_URL}/api/demo/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carrier: 'Wi-Fi',
      nickname: `bot_${botIndex + 1}`,
      roomId,
      inviteCode: INVITE_CODE,
    }),
  });
  stats.checkInMs.push(checkIn.ms);
  if (!checkIn.ok || !checkIn.json?.ticket || !checkIn.json?.eventId) {
    stats.checkInErrors += 1;
    recordError('check-in', botIndex, checkIn);
    return;
  }

  const { ticket, eventId } = checkIn.json;
  const start = await fetchJson(
    `${BASE_URL}/api/quiz/events/${encodeURIComponent(eventId)}/start`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Baci-Quiz-Ticket': ticket,
      },
      body: JSON.stringify({
        integrityTier: 'device',
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        startRequestId: randomUUID(),
        appVersion: 'bot-runner-1',
        platform: 'android',
      }),
    }
  );
  stats.startMs.push(start.ms);
  if (!start.ok || !start.json?.attemptId) {
    stats.startErrors += 1;
    recordError('start', botIndex, start);
    return;
  }

  let attempt = start.json;
  let question = attempt.question;
  let qCount = 0;

  while (question && qCount < 15) {
    qCount += 1;
    const jitter =
      THINK_MS > 0
        ? Math.floor(THINK_MS * (0.6 + ((botIndex + qCount) % 5) * 0.2))
        : 0;
    if (jitter > 0) await sleep(jitter);

    const choice = question.options?.[0]?.id || 'opt-a';
    const ans = await fetchJson(
      `${BASE_URL}/api/quiz/attempts/${encodeURIComponent(attempt.attemptId)}/answers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Ticket': ticket,
        },
        body: JSON.stringify({
          questionId: question.id,
          answer: choice,
        }),
      }
    );
    stats.answerMs.push(ans.ms);
    if (!ans.ok) {
      stats.answerErrors += 1;
      recordError(`answer-q${qCount}`, botIndex, ans);
      return;
    }
    stats.answersSucceeded += 1;
    attempt = ans.json;
    question = attempt.question;
  }

  if (attempt?.status === 'submitted_pending_results') {
    stats.botsCompleted += 1;
  }
}

async function main() {
  const startedAt = performance.now();
  const tasks = Array.from({ length: BOT_COUNT }, (_, idx) => runBot(idx));
  await Promise.all(tasks);
  const totalSec = (performance.now() - startedAt) / 1000;

  const sortNum = (arr) => [...arr].sort((a, b) => a - b);
  const ci = sortNum(stats.checkInMs);
  const st = sortNum(stats.startMs);
  const an = sortNum(stats.answerMs);
  const under1s = an.filter((ms) => ms <= 1000).length;

  const summary = {
    baseUrl: BASE_URL,
    botCount: BOT_COUNT,
    roomCount: ROOM_COUNT,
    durationSec: Number(totalSec.toFixed(2)),
    botsCompleted: stats.botsCompleted,
    answersSucceeded: stats.answersSucceeded,
    answerRps: Number(
      (stats.answersSucceeded / Math.max(0.01, totalSec)).toFixed(1)
    ),
    errors: {
      checkIn: stats.checkInErrors,
      start: stats.startErrors,
      answer: stats.answerErrors,
    },
    latencyMs: {
      checkIn: {
        p50: Number(percentile(ci, 0.5).toFixed(1)),
        p95: Number(percentile(ci, 0.95).toFixed(1)),
        p99: Number(percentile(ci, 0.99).toFixed(1)),
      },
      start: {
        p50: Number(percentile(st, 0.5).toFixed(1)),
        p95: Number(percentile(st, 0.95).toFixed(1)),
        p99: Number(percentile(st, 0.99).toFixed(1)),
      },
      answer: {
        p50: Number(percentile(an, 0.5).toFixed(1)),
        p95: Number(percentile(an, 0.95).toFixed(1)),
        p99: Number(percentile(an, 0.99).toFixed(1)),
        max: Number((an[an.length - 1] ?? 0).toFixed(1)),
        under1sRatePct:
          an.length > 0 ? Number(((under1s / an.length) * 100).toFixed(2)) : 0,
      },
    },
    errorSamples: stats.errorSamples,
  };

  if (OUT_FILE) {
    writeFileSync(OUT_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));

  const totalErrors =
    stats.checkInErrors + stats.startErrors + stats.answerErrors;
  if (totalErrors > 0 || stats.botsCompleted < BOT_COUNT) {
    process.exitCode = 1;
  }
}

main();
