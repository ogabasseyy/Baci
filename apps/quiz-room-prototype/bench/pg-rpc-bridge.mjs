import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PG_BIN = '/opt/homebrew/opt/postgresql@17/bin';
export const PG_HOST = '127.0.0.1';

const SRC_DIR = process.env.QUIZ_SRC_DIR
  ? path.resolve(process.env.QUIZ_SRC_DIR)
  : path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');

export function uuidFromIndex(prefixHex, n) {
  return `${prefixHex}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export async function seedE2eDatabase(
  pgPort,
  eventId,
  merchantId,
  startsAtMs,
  endsAtMs,
  roomIds
) {
  const { quizAnswerKeyHash } = await import(
    pathToFileURL(path.join(SRC_DIR, 'crypto.ts')).href
  );
  const productId = uuidFromIndex('20000000', 1);
  const answerHash = await quizAnswerKeyHash('opt-a');
  let sql = `
    INSERT INTO public.merchants (id, email, business_name, slug)
    VALUES ('${merchantId}', 'demo@baci.test', 'Ogabassey Demo', 'ogabassey-demo');
    INSERT INTO public.products (id, merchant_id, name, price, status)
    VALUES ('${productId}', '${merchantId}', 'Demo Phone', 1000, 'active');
    INSERT INTO public.quiz_events (
      id, merchant_id, slug, title, starts_at, ends_at,
      status, mode, contract_version, backend_mode, question_count,
      time_per_question_seconds, maximum_play_seconds, live_window_seconds,
      max_attempts, rules_version, expected_room_count,
      compliance_verified, regulatory_basis, regulatory_jurisdiction,
      regulatory_evidence_ref, claim_window_seconds, settings
    ) VALUES (
      '${eventId}', '${merchantId}', 'e2e-replay-event', 'E2E Replay Event',
      to_timestamp(${startsAtMs / 1000.0}), to_timestamp(${endsAtMs / 1000.0}),
      'active', 'live', 2, 'edge_rooms', 10, 10, 100, 600, 1, '2026-11', ${roomIds.length},
      true, 'free_skill_competition', 'NG', 'e2e-evidence', 3600,
      '{"prize_product_id":"${productId}","prize_product_name":"Demo Phone","prize_name":"Demo Prize"}'::jsonb
    );
    INSERT INTO public.quiz_prize_reservations (
      event_id, merchant_id, product_id, inventory_kind, quantity, state
    ) VALUES ('${eventId}', '${merchantId}', '${productId}', 'unlimited', 1, 'reserved');
  `;
  const slots = [];
  for (let s = 1; s <= 10; s += 1) {
    const slotId = uuidFromIndex('40000000', s);
    const varId = uuidFromIndex('50000000', s);
    sql += `
      INSERT INTO public.quiz_question_slots (id, event_id, slot_index, active)
      VALUES ('${slotId}', '${eventId}', ${s}, true);
      INSERT INTO public.quiz_question_variants (
        id, slot_id, variant_key, prompt, options, answer_key_hash, active
      ) VALUES (
        '${varId}', '${slotId}', 'var-1', 'Q${s}',
        '[{"id":"opt-a","label":"A"},{"id":"opt-b","label":"B"}]'::jsonb,
        '${answerHash}', true
      );
    `;
    slots.push({
      id: slotId,
      slotIndex: s,
      active: true,
      variants: [
        {
          id: varId,
          slotId,
          prompt: `Q${s}`,
          options: [
            { id: 'opt-a', label: 'A' },
            { id: 'opt-b', label: 'B' },
          ],
          answerKeyHash: answerHash,
          active: true,
        },
      ],
    });
  }
  const players = [];
  for (let p = 1; p <= 24; p += 1) {
    const custId = uuidFromIndex('60000000', p);
    const userId = uuidFromIndex('70000000', p);
    const admId = uuidFromIndex('80000000', p);
    const roomIdx = (p - 1) % 2;
    const roomId = roomIds[roomIdx];
    const deviceHash = String(p).padStart(64, '0');
    const reqId = uuidFromIndex('a0000000', p);
    sql += `
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'p${p}@baci.test');
      INSERT INTO public.customers (id, merchant_id, user_id, email, username)
      VALUES ('${custId}', '${merchantId}', '${userId}', 'p${p}@baci.test', 'p_${p}');
      INSERT INTO public.quiz_event_admissions (
        id, event_id, merchant_id, customer_id, user_id, room_index, room_id,
        normalized_email, device_hash, leaderboard_username, rules_version,
        app_version, platform, check_in_request_id, status
      ) VALUES (
        '${admId}', '${eventId}', '${merchantId}', '${custId}', '${userId}',
        ${roomIdx}, '${roomId}', 'p${p}@baci.test', '${deviceHash}', 'p_${p}',
        '2026-11', '2.10.0', 'android', '${reqId}', 'admitted'
      );
    `;
    players.push({ p, custId, userId, admId, roomId, deviceHash });
  }
  pgExec(pgPort, sql);
  return { slots, players };
}

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, PG_HOST, () => {
      const addr = srv.address();
      srv.close(() =>
        resolve(typeof addr === 'object' && addr ? addr.port : 55439)
      );
    });
  });
}

export function pgExec(port, sql, cwd) {
  return execFileSync(
    path.join(PG_BIN, 'psql'),
    [
      '-h',
      PG_HOST,
      '-p',
      String(port),
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...(cwd ? { cwd } : {}),
    }
  ).trim();
}

export function sqlLit(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

export function startEphemeralPg17(pgPort) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-e2e-pg-'));
  execFileSync(
    path.join(PG_BIN, 'initdb'),
    [
      '-D',
      dataDir,
      '-U',
      'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--locale=C',
    ],
    { stdio: 'ignore' }
  );
  fs.appendFileSync(
    path.join(dataDir, 'postgresql.conf'),
    `\nport = ${pgPort}\nlisten_addresses = '${PG_HOST}'\nsynchronous_commit = on\n`,
    'utf8'
  );
  execFileSync(
    path.join(PG_BIN, 'pg_ctl'),
    ['-D', dataDir, '-l', path.join(dataDir, 'pg.log'), '-w', 'start'],
    { stdio: 'ignore' }
  );
  return {
    dataDir,
    stop: () => {
      try {
        execFileSync(
          path.join(PG_BIN, 'pg_ctl'),
          ['-D', dataDir, '-m', 'immediate', 'stop'],
          {
            stdio: 'ignore',
          }
        );
      } catch {
        /* noop */
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function sealRoomsInPg(pgPort, eventId, closeMs, roomIds, rooms) {
  for (const rid of roomIds) {
    const m = rooms.get(rid).getSealManifest();
    pgExec(
      pgPort,
      `SET ROLE quiz_edge_batch_worker;
       SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', false);
       SELECT public.record_quiz_edge_room_seal_v2('${eventId}'::uuid, ${sqlLit(rid)}, to_timestamp(${closeMs / 1000.0}), 'completed', ${m.attemptCount}, ${m.answerCount}, ${sqlLit(`{${m.batchIds.join(',')}}`)}::text[], ${m.batchCount}, ${sqlLit(m.roomChecksumSha256)});
       RESET ROLE;`
    );
  }
}

export function applyLocalSchema(pgPort, protoDir, repoRoot) {
  pgExec(
    pgPort,
    fs.readFileSync(
      path.join(protoDir, 'sql-bench/bootstrap-local-pg.sql'),
      'utf8'
    ),
    path.join(repoRoot, 'apps/quiz-room-prototype/sql-bench')
  );
  pgExec(
    pgPort,
    fs.readFileSync(
      path.join(
        repoRoot,
        'supabase/migrations/20261118170000_quiz_stage1_edge_prototype_v2.sql'
      ),
      'utf8'
    )
  );
}

export function startPgIngestRpcBridge(port, expectedJwt) {
  const server = http.createServer(async (req, res) => {
    if (
      req.method !== 'POST' ||
      req.url !== '/rest/v1/rpc/ingest_quiz_edge_attempt_batch_v2'
    ) {
      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${expectedJwt}`) {
      res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    try {
      const sql = `
        SET ROLE quiz_edge_batch_worker;
        SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', false);
        SELECT public.ingest_quiz_edge_attempt_batch_v2(
          ${sqlLit(body.p_event_id)}::uuid,
          ${sqlLit(body.p_room_id)},
          ${sqlLit(body.p_batch_id)},
          ${sqlLit(body.p_batch_checksum_sha256)},
          ${Number(body.p_attempt_count)}::integer,
          ${Number(body.p_answer_count)}::integer,
          ${sqlLit(JSON.stringify(body.p_attempts))}::jsonb,
          ${Number(body.p_part_index ?? 0)}::integer,
          ${Number(body.p_total_parts ?? 1)}::integer
        )::text;
        RESET ROLE;
      `;
      const lines = pgExec(port, sql).split('\n').filter(Boolean);
      const jsonLine = lines.at(-1) ?? '{"ingested":false}';
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(jsonLine);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  });

  return new Promise((resolve) => {
    server.listen(0, PG_HOST, () => {
      const addr = server.address();
      resolve({
        server,
        port: typeof addr === 'object' && addr ? addr.port : 0,
      });
    });
  });
}
