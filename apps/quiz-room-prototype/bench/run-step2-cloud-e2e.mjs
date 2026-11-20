#!/usr/bin/env node
/**
 * Real Cloud End-to-End Proof (Step 2):
 *   N Players -> Cloudflare WEUR QuizRoomDOs -> Real Cloudflare Queue (`baci-quiz-attempts-stage1`)
 *   -> Real Cloudflare Queue Consumer -> Real Temporary Supabase Branch PostgREST
 *   (`ingest_quiz_edge_attempt_batch_v2` as `quiz_edge_batch_worker`)
 *   -> Room Seal -> `score_and_materialize_edge_quiz_event_v2` -> 1 Winner Award.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const BASE_URL = (
  process.env.BASE_URL ||
  'https://baci-quiz-room-prototype.ogabassey-ai.workers.dev'
).replace(/\/$/, '');
const DB_URL = process.env.BRANCH_DB_URL || '';
const TICKET_SECRET = process.env.QUIZ_TICKET_SECRET || '';
const COORD_SECRET = process.env.QUIZ_INTERNAL_COORDINATOR_SECRET || '';
const PLAYER_COUNT = Number.parseInt(process.env.PLAYER_COUNT || '1000', 10);
const ROOM_COUNT = Number.parseInt(process.env.ROOM_COUNT || '4', 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || '150', 10);
const OUT_FILE = process.env.OUT_FILE || '';

if (!DB_URL || !TICKET_SECRET || !COORD_SECRET) {
  console.error(
    'ERROR: BRANCH_DB_URL, QUIZ_TICKET_SECRET, QUIZ_INTERNAL_COORDINATOR_SECRET are required.'
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
const quizAnswerKeyHash = (ans) =>
  sha256Hex(ans.trim().toLowerCase().replace(/\s+/g, ' '));

function signTicket(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `bqt1.${b64}`;
  const sig = createHmac('sha256', TICKET_SECRET)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

function psql(sql) {
  return execFileSync(
    '/opt/homebrew/bin/psql',
    [DB_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  ).trim();
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1)
  );
  return sorted[idx] ?? 0;
}

async function fetchJsonRetry(url, opts, maxRetries = 2) {
  let last = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
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
      last = { ok: res.ok, status: res.status, ms, json };
      if (res.ok || (res.status >= 400 && res.status < 500)) return last;
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        ms: performance.now() - t0,
        json: { error: err instanceof Error ? err.message : String(err) },
      };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxRetries) await sleep(200 * (attempt + 1));
  }
  return last;
}

async function main() {
  const eventId = randomUUID();
  const merchantId = randomUUID();
  const productId = randomUUID();
  const nowMs = Date.now();
  const startsAtMs = nowMs - 10_000;
  const endsAtMs = nowMs + 600_000;
  const answerHash = quizAnswerKeyHash('opt-a');
  const roomIds = Array.from(
    { length: ROOM_COUNT },
    (_, i) => `${eventId}:room-${String(i).padStart(4, '0')}`
  );
  const slots = Array.from({ length: 10 }, (_, idx) => {
    const slotId = randomUUID();
    const varId = randomUUID();
    return {
      id: slotId,
      slotIndex: idx + 1,
      active: true,
      variants: [
        {
          id: varId,
          slotId,
          prompt: `Cloud E2E Q${idx + 1}`,
          options: [
            { id: 'opt-a', label: 'Option A' },
            { id: 'opt-b', label: 'Option B' },
          ],
          answerKeyHash: answerHash,
          active: true,
        },
      ],
    };
  });

  console.log(
    `[1/6] Seeding Supabase branch (${PLAYER_COUNT} players, ${ROOM_COUNT} rooms, event ${eventId})...`
  );
  const seedT0 = performance.now();
  const slotSql = slots
    .map(
      (s) => `
      INSERT INTO public.quiz_question_slots (id, event_id, slot_index, active)
      VALUES ('${s.id}', '${eventId}', ${s.slotIndex}, true);
      INSERT INTO public.quiz_question_variants (id, slot_id, variant_key, prompt, options, answer_key_hash, active)
      VALUES ('${s.variants[0].id}', '${s.id}', 'v1', 'Q${s.slotIndex}',
              '[{"id":"opt-a","label":"Option A"},{"id":"opt-b","label":"Option B"}]'::jsonb,
              '${answerHash}', true);`
    )
    .join('\n');

  const players = Array.from({ length: PLAYER_COUNT }, (_, idx) => {
    const p = idx + 1;
    return {
      p,
      userId: randomUUID(),
      customerId: randomUUID(),
      admissionId: randomUUID(),
      roomIndex: idx % ROOM_COUNT,
      roomId: roomIds[idx % ROOM_COUNT],
      deviceHash: String(p).padStart(64, '0'),
      reqId: randomUUID(),
    };
  });

  const usersVals = players
    .map(
      (u) =>
        `('${u.userId}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cloud_p${u.p}_${eventId.slice(0, 8)}@baci.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb)`
    )
    .join(',');
  const custVals = players
    .map(
      (u) =>
        `('${u.customerId}','${merchantId}','${u.userId}','cloud_p${u.p}_${eventId.slice(0, 8)}@baci.test','cloud_p${u.p}')`
    )
    .join(',');
  const admVals = players
    .map(
      (u) =>
        `('${u.admissionId}','${eventId}','${merchantId}','${u.customerId}','${u.userId}',${u.roomIndex},'${u.roomId}','cloud_p${u.p}_${eventId.slice(0, 8)}@baci.test','${u.deviceHash}','cloud_p${u.p}','2026-11','2.10.0','android','${u.reqId}','admitted')`
    )
    .join(',');

  psql(`
    BEGIN;
    INSERT INTO public.merchants (id, email, business_name, slug)
    VALUES ('${merchantId}', 'cloud-e2e-${eventId.slice(0, 8)}@baci.test', 'Cloud E2E Merchant', 'cloud-e2e-${eventId.slice(0, 8)}');
    INSERT INTO public.products (id, merchant_id, name, price, status)
    VALUES ('${productId}', '${merchantId}', 'Cloud E2E Prize Phone', 1000, 'active');
    INSERT INTO public.quiz_events (
      id, merchant_id, slug, title, starts_at, ends_at,
      status, mode, contract_version, backend_mode, question_count,
      time_per_question_seconds, maximum_play_seconds, live_window_seconds,
      max_attempts, rules_version, expected_room_count,
      compliance_verified, regulatory_basis, regulatory_jurisdiction,
      regulatory_evidence_ref, claim_window_seconds, settings
    ) VALUES (
      '${eventId}', '${merchantId}', 'cloud-e2e-${eventId.slice(0, 8)}', 'Cloud E2E Queue Proof',
      to_timestamp(${startsAtMs / 1000.0}), to_timestamp(${endsAtMs / 1000.0}),
      'active', 'live', 2, 'edge_rooms', 10, 10, 100, 600, 1, '2026-11', ${ROOM_COUNT},
      true, 'free_skill_competition', 'NG', 'cloud-e2e', 3600,
      '{"prize_product_id":"${productId}","prize_product_name":"Cloud E2E Prize Phone","prize_name":"Cloud E2E Prize"}'::jsonb
    );
    INSERT INTO public.quiz_prize_reservations (
      event_id, merchant_id, product_id, inventory_kind, quantity, state
    ) VALUES ('${eventId}', '${merchantId}', '${productId}', 'unlimited', 1, 'reserved');
    ${slotSql}
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES ${usersVals};
    INSERT INTO public.customers (id, merchant_id, user_id, email, username)
    VALUES ${custVals};
    INSERT INTO public.quiz_event_admissions (
      id, event_id, merchant_id, customer_id, user_id, room_index, room_id,
      normalized_email, device_hash, leaderboard_username, rules_version,
      app_version, platform, check_in_request_id, status
    ) VALUES ${admVals};
    COMMIT;
  `);
  const seedMs = Math.round(performance.now() - seedT0);

  console.log(`[2/6] Initializing ${ROOM_COUNT} WEUR Cloudflare rooms...`);
  const initRes = await fetchJsonRetry(
    `${BASE_URL}/api/quiz/admin/init-rooms`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${COORD_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomIds,
        config: {
          eventId,
          merchantId,
          mode: 'live',
          contractVersion: 2,
          rulesVersion: '2026-11',
          questionCount: 10,
          timePerQuestionSeconds: 10,
          maxAttempts: 1,
          startsAtMs,
          endsAtMs,
          status: 'active',
          slots,
          retentionPeriodMs: 600_000,
        },
      }),
    }
  );
  if (!initRes.ok) {
    throw new Error(`init-rooms failed: ${JSON.stringify(initRes)}`);
  }

  console.log(
    `[3/6] Running ${PLAYER_COUNT} players across ${ROOM_COUNT} rooms (concurrency ${CONCURRENCY})...`
  );
  const playT0 = performance.now();
  const answerMs = [];
  let completed = 0;
  let errors = 0;
  let nextIdx = 0;

  async function workerLoop() {
    while (true) {
      const idx = nextIdx;
      nextIdx += 1;
      if (idx >= players.length) return;
      const u = players[idx];
      const ticket = signTicket({
        userId: u.userId,
        customerId: u.customerId,
        merchantId,
        eventId,
        roomId: u.roomId,
        admissionId: u.admissionId,
        deviceHash: u.deviceHash,
        leaderboardUsername: `cloud_p${u.p}`,
        expiresAtMs: endsAtMs + 60_000,
        mode: 'live',
      });
      const startRes = await fetchJsonRetry(
        `${BASE_URL}/api/quiz/events/${encodeURIComponent(eventId)}/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Baci-Quiz-Ticket': ticket,
          },
          body: JSON.stringify({
            integrityTier: 'device',
            acceptedRulesVersion: '2026-11',
            termsAccepted: true,
            startRequestId: randomUUID(),
            appVersion: '2.10.0',
            platform: 'android',
          }),
        }
      );
      if (!startRes.ok || !startRes.json?.attemptId) {
        errors += 1;
        continue;
      }
      let state = startRes.json;
      let q = state.question;
      let qIdx = 0;
      while (q && qIdx < 12) {
        qIdx += 1;
        // Player 1 answers all 10 opt-a (perfect 10/10); others vary
        const choice = u.p === 1 || (u.p + qIdx) % 3 !== 0 ? 'opt-a' : 'opt-b';
        const ansRes = await fetchJsonRetry(
          `${BASE_URL}/api/quiz/attempts/${encodeURIComponent(state.attemptId)}/answers`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Baci-Quiz-Ticket': ticket,
            },
            body: JSON.stringify({ questionId: q.id, answer: choice }),
          }
        );
        answerMs.push(ansRes.ms);
        if (!ansRes.ok) {
          errors += 1;
          break;
        }
        state = ansRes.json;
        q = state.question;
      }
      if (state?.status === 'submitted_pending_results') completed += 1;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, players.length) }, () =>
      workerLoop()
    )
  );
  const playSec = (performance.now() - playT0) / 1000;

  console.log(
    `[4/6] Sealing ${ROOM_COUNT} rooms on Cloudflare & recording manifests in Supabase...`
  );
  const persistedCloseAtMs = Date.now();
  const manifests = await Promise.all(
    roomIds.map(async (roomId) => {
      const res = await fetchJsonRetry(`${BASE_URL}/api/quiz/admin/seal-room`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${COORD_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          eventId,
          endsAtMs,
          persistedCloseAtMs,
          mode: 'persisted_close',
        }),
      });
      if (!res.ok)
        throw new Error(`seal-room ${roomId} failed: ${JSON.stringify(res)}`);
      return res.json;
    })
  );

  for (const m of manifests) {
    const batchArr = `{${(m.batchIds || []).join(',')}}`;
    psql(`
      BEGIN;
      SET LOCAL ROLE quiz_edge_batch_worker;
      SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', true);
      SELECT public.record_quiz_edge_room_seal_v2(
        '${eventId}'::uuid, '${m.roomId}', to_timestamp(${persistedCloseAtMs / 1000.0}),
        'completed', ${m.attemptCount}, ${m.answerCount},
        '${batchArr}'::text[], ${m.batchCount}, '${m.roomChecksumSha256}'
      );
      COMMIT;
    `);
  }

  console.log(
    `[5/6] Waiting for real Cloudflare Queue -> Supabase PostgREST delivery (${completed} attempts)...`
  );
  const drainT0 = performance.now();
  let stagedCount = 0;
  let batchCount = 0;
  for (let wait = 0; wait < 90; wait += 1) {
    const counts = psql(`
      SELECT count(*)::text || ',' || (SELECT count(*)::text FROM private.quiz_edge_attempt_batches WHERE event_id = '${eventId}'::uuid)
      FROM private.quiz_edge_attempt_staging
      WHERE event_id = '${eventId}'::uuid;
    `);
    const [s, b] = counts.split(',').map((n) => Number.parseInt(n, 10) || 0);
    stagedCount = s;
    batchCount = b;
    if (stagedCount >= completed) break;
    await sleep(1000);
  }
  const queueDrainSec = Number(
    ((performance.now() - drainT0) / 1000).toFixed(2)
  );

  console.log(
    `[6/6] Running Supabase score_and_materialize_edge_quiz_event_v2 (staged=${stagedCount}, batches=${batchCount})...`
  );
  const scoreT0 = performance.now();
  const scoreJson = psql(
    `SELECT private.score_and_materialize_edge_quiz_event_v2('${eventId}'::uuid)::text;`
  );
  const scoreMs = Math.round(performance.now() - scoreT0);
  const awardsCount = Number.parseInt(
    psql(
      `SELECT count(*) FROM public.quiz_awards WHERE event_id = '${eventId}'::uuid;`
    ),
    10
  );

  const sortedAns = [...answerMs].sort((a, b) => a - b);
  const under1s = sortedAns.filter((x) => x <= 1000).length;
  const result = {
    eventId,
    playerCount: PLAYER_COUNT,
    roomCount: ROOM_COUNT,
    seedMs,
    playSec: Number(playSec.toFixed(2)),
    playersCompleted: completed,
    clientErrors: errors,
    answersCount: sortedAns.length,
    answerRps: Number((sortedAns.length / Math.max(0.01, playSec)).toFixed(1)),
    answerLatencyMs: {
      p50: Number(percentile(sortedAns, 0.5).toFixed(1)),
      p95: Number(percentile(sortedAns, 0.95).toFixed(1)),
      p99: Number(percentile(sortedAns, 0.99).toFixed(1)),
      under1sRatePct:
        sortedAns.length > 0
          ? Number(((under1s / sortedAns.length) * 100).toFixed(2))
          : 0,
    },
    cloudflareQueueDelivery: {
      batchesDeliveredToSupabase: batchCount,
      attemptsStagedInSupabase: stagedCount,
      queueDrainSec,
    },
    supabaseFinalization: {
      scoreAndMaterializeMs: scoreMs,
      scoreResult: scoreJson ? JSON.parse(scoreJson) : null,
      awardsCreated: awardsCount,
    },
  };

  if (OUT_FILE) writeFileSync(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  if (stagedCount !== completed || awardsCount !== 1) {
    console.error(
      `MISMATCH: staged=${stagedCount}, completed=${completed}, awards=${awardsCount}`
    );
    process.exit(1);
  }
}

main();
