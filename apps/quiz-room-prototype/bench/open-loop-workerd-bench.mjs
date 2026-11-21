#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.QUIZ_PROTO_DIR
  ? path.resolve(process.env.QUIZ_PROTO_DIR)
  : path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const WRANGLER_BIN = path.join(REPO_ROOT, 'node_modules/.bin/wrangler');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 8787;
      srv.close(() => resolve(port));
    });
  });
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor(Math.max(0, Math.min(1, p)) * (sortedAsc.length - 1))
  );
  return sortedAsc[idx] ?? 0;
}

async function waitForServer(baseUrl, timeoutMs = 20_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/quiz/events/probe-ready/status`);
      if (res.status > 0) return;
    } catch {
      // Server still booting.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for workerd at ${baseUrl}`);
}

async function runOpenLoopPoint({
  baseUrl,
  offeredRps,
  durationMs,
  maxInFlight,
  eventId,
  roomId,
}) {
  const totalScheduled = Math.floor((offeredRps * durationMs) / 1000);
  // Provision enough started attempts so no actor finishes all 10 questions during the burst.
  const actorCount = Math.max(120, Math.ceil(totalScheduled / 8));
  const actors = [];
  for (let i = 0; i < actorCount; i += 1) {
    const ci = await fetch(`${baseUrl}/api/demo/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        nickname: `ol_bot_${offeredRps}_${i}`,
        carrier: i % 2 === 0 ? 'MTN' : 'Glo',
        roomId,
      }),
    });
    if (!ci.ok) throw new Error(`check-in failed: ${ci.status}`);
    const { ticket } = await ci.json();
    const st = await fetch(
      `${baseUrl}/api/quiz/events/${encodeURIComponent(eventId)}/start`,
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
          startRequestId: `00000000-0000-4000-8000-${String(
            offeredRps * 100000 + i
          )
            .padStart(12, '0')
            .slice(-12)}`,
          appVersion: '2.10.0',
          platform: 'android',
        }),
      }
    );
    if (!st.ok)
      throw new Error(`start failed: ${st.status} ${await st.text()}`);
    const started = await st.json();
    actors.push({
      ticket,
      attemptId: started.attemptId,
      questionId: started.question?.id,
    });
  }

  const intervalMs = 1000 / offeredRps;
  const latenciesMs = [];
  let inFlight = 0;
  let droppedIterations = 0;
  let errors = 0;
  let completed = 0;
  const pending = [];
  const t0 = performance.now();

  for (let idx = 0; idx < totalScheduled; idx += 1) {
    const dueMs = t0 + idx * intervalMs;
    const now = performance.now();
    if (dueMs > now) {
      await new Promise((r) => setTimeout(r, dueMs - now));
    }
    const dispatchLagMs = performance.now() - dueMs;
    // Count a dropped iteration if event-loop / backpressure lags > 250ms behind schedule
    // or in-flight ceiling is reached.
    if (inFlight >= maxInFlight || dispatchLagMs > 250) {
      droppedIterations += 1;
      continue;
    }

    const actor = actors[idx % actors.length];
    if (!actor?.questionId) {
      droppedIterations += 1;
      continue;
    }

    inFlight += 1;
    const reqStart = performance.now();
    const p = fetch(
      `${baseUrl}/api/quiz/attempts/${encodeURIComponent(actor.attemptId)}/answers`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Ticket': actor.ticket,
        },
        body: JSON.stringify({
          questionId: actor.questionId,
          answer: 'opt-a',
        }),
      }
    )
      .then(async (res) => {
        const elapsed = performance.now() - reqStart;
        latenciesMs.push(elapsed);
        if (!res.ok) {
          errors += 1;
          await res.text();
          return;
        }
        const body = await res.json();
        if (body.question?.id) actor.questionId = body.question.id;
        completed += 1;
      })
      .catch(() => {
        errors += 1;
      })
      .finally(() => {
        inFlight -= 1;
      });
    pending.push(p);
  }

  await Promise.all(pending);
  const actualDurationSec = Math.max(0.001, (performance.now() - t0) / 1000);
  const sorted = [...latenciesMs].sort((a, b) => a - b);

  return {
    offeredRps,
    totalScheduled,
    completed,
    droppedIterations,
    errors,
    achievedRps: completed / actualDurationSec,
    httpP50Ms: percentile(sorted, 0.5),
    httpP95Ms: percentile(sorted, 0.95),
    httpP99Ms: percentile(sorted, 0.99),
  };
}

async function main() {
  const port = await findFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workerd-bench-'));
  const adminSecret = 'bench-coord-secret-local-only';

  const proc = spawn(
    WRANGLER_BIN,
    [
      'dev',
      '--local',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      tmpDir,
      '--var',
      'QUIZ_TICKET_SECRET:bench-ticket-secret-local-only',
      '--var',
      'QUIZ_JWT_SECRET:bench-jwt-secret-local-only',
      '--var',
      `QUIZ_INTERNAL_COORDINATOR_SECRET:${adminSecret}`,
      '--var',
      'QUIZ_BATCH_WORKER_JWT:bench-worker-jwt-local-only',
    ],
    {
      cwd: PROTO_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl);
    const rpsList = [100, 250, 400, 600];
    const eventId = 'workerd-open-loop-evt';
    const setupRes = await fetch(`${baseUrl}/api/demo/admin/setup-round`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminSecret}`,
      },
      body: JSON.stringify({
        round: 2,
        eventId,
        roomCount: rpsList.length,
        durationMs: 300_000,
      }),
    });
    if (!setupRes.ok) {
      throw new Error(
        `setup-round returned ${setupRes.status}: ${await setupRes.text()}`
      );
    }

    const loadPoints = [];
    for (let idx = 0; idx < rpsList.length; idx += 1) {
      const rps = rpsList[idx];
      const point = await runOpenLoopPoint({
        baseUrl,
        offeredRps: rps,
        durationMs: 2_500,
        maxInFlight: 200,
        eventId,
        roomId: `room-${String(idx).padStart(4, '0')}`,
      });
      loadPoints.push(point);
    }
    const output = {
      generatedAt: new Date().toISOString(),
      runtime: 'wrangler-dev-local-workerd',
      loadPoints,
    };
    const outPath = path.join(__dirname, 'workerd-open-loop-results.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(JSON.stringify(output, null, 2));
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
