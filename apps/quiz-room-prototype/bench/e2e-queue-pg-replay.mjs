#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playAndSealE2eRooms } from './e2e-queue-pg-replay-setup.mjs';
import {
  applyLocalSchema,
  findFreePort,
  PG_HOST,
  pgExec,
  sealRoomsInPg,
  seedE2eDatabase,
  startEphemeralPg17,
  startPgIngestRpcBridge,
  uuidFromIndex,
} from './pg-rpc-bridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = process.env.QUIZ_PROTO_DIR
  ? path.resolve(process.env.QUIZ_PROTO_DIR)
  : path.resolve(__dirname, '..');
const SRC_DIR = process.env.QUIZ_SRC_DIR
  ? path.resolve(process.env.QUIZ_SRC_DIR)
  : path.resolve(__dirname, '../src');
const REPO_ROOT = process.env.QUIZ_REPO_ROOT
  ? path.resolve(process.env.QUIZ_REPO_ROOT)
  : path.resolve(__dirname, '../../..');

const loadSrc = (file) => import(pathToFileURL(path.join(SRC_DIR, file)).href);

async function main() {
  const [
    { createEmptyControlState, QuizControlStateStore },
    { EventCoordinatorEngine },
    { NodeSqliteAdapter },
    { handleQuizQueueBatch },
    { QuizRoomEngine },
  ] = await Promise.all(
    [
      'control-state.ts',
      'coordinator.ts',
      'node-sqlite-adapter.ts',
      'queue-consumer.ts',
      'room-do.ts',
    ].map(loadSrc)
  );
  const pgPort = await findFreePort();
  const adapters = [];
  let bridge = null;
  let pgCluster = null;

  try {
    pgCluster = startEphemeralPg17(pgPort);
    applyLocalSchema(pgPort, PROTO_DIR, REPO_ROOT);
    const merchantId = uuidFromIndex('10000000', 1);
    const eventId = uuidFromIndex('30000000', 1);
    const workerJwt = 'e2e-local-batch-worker-jwt';
    const endsAtMs = Date.now() - 5_000;
    const startsAtMs = endsAtMs - 600_000;
    const closeMs = endsAtMs + 1_200;
    const roomIds = [
      `room-${eventId}-0000`,
      `room-${eventId}-0001`,
      `room-${eventId}-never`,
    ];
    const { slots, players } = await seedE2eDatabase(
      pgPort,
      eventId,
      merchantId,
      startsAtMs,
      endsAtMs,
      roomIds
    );
    const { rooms, packedByRoom, coordSnap } = await playAndSealE2eRooms({
      eventId,
      merchantId,
      startsAtMs,
      endsAtMs,
      closeMs,
      roomIds,
      slots,
      players,
      adapters,
      QuizControlStateStore,
      createEmptyControlState,
      EventCoordinatorEngine,
      NodeSqliteAdapter,
      QuizRoomEngine,
    });

    bridge = await startPgIngestRpcBridge(pgPort, workerJwt);
    const consumerEnv = {
      SUPABASE_URL: `http://${PG_HOST}:${bridge.port}`,
      QUIZ_BATCH_WORKER_JWT: workerJwt,
    };

    const r0Msgs = packedByRoom.get(roomIds[0]) ?? [];
    const r1Msgs = packedByRoom.get(roomIds[1]) ?? [];
    const droppedMsg = r0Msgs[0];
    let ackCount = 0;
    let retryCount = 0;
    const makeBatch = (msgs) => ({
      queue: 'quiz-edge-ingest',
      messages: msgs.map((m, i) => ({
        id: `${m.batchId}-${i}`,
        body: m,
        ack: () => {
          ackCount += 1;
        },
        retry: () => {
          retryCount += 1;
        },
      })),
    });

    const firstIngest = await handleQuizQueueBatch(
      makeBatch([...r0Msgs.slice(1), ...r1Msgs]),
      consumerEnv
    );
    const dupIngest = await handleQuizQueueBatch(
      makeBatch(r1Msgs.slice(0, 1)),
      consumerEnv
    );

    sealRoomsInPg(pgPort, eventId, closeMs, roomIds, rooms);

    let blockedBeforeReplay = false;
    try {
      pgExec(
        pgPort,
        `SELECT private.score_and_materialize_edge_quiz_event_v2('${eventId}'::uuid);`
      );
    } catch {
      blockedBeforeReplay = true;
    }

    const replayedFromJournal = rooms
      .get(roomIds[0])
      .getJournalBatch(droppedMsg.batchId);
    const replayIngest = await handleQuizQueueBatch(
      makeBatch([replayedFromJournal]),
      consumerEnv
    );

    const hasIncremental = Number(
      pgExec(
        pgPort,
        `SELECT count(*) FROM pg_proc WHERE proname = 'score_quiz_edge_staged_batches_incremental_v2';`
      )
    );
    if (hasIncremental > 0) {
      pgExec(
        pgPort,
        `SET ROLE quiz_edge_batch_worker;
         SELECT pg_catalog.set_config('request.jwt.claim.role', 'quiz_edge_batch_worker', false);
         SELECT public.score_quiz_edge_staged_batches_incremental_v2('${eventId}'::uuid, 1);
         RESET ROLE;`
      );
    }
    const finalScore = JSON.parse(
      pgExec(
        pgPort,
        `SELECT private.score_and_materialize_edge_quiz_event_v2('${eventId}'::uuid)::text;`
      )
    );
    pgExec(
      pgPort,
      `UPDATE private.quiz_test_publication_control_v2 SET score_repair_ready = true WHERE singleton;
       SELECT public.set_quiz_runtime_control_v2(true, true);`
    );
    const deadlines = JSON.parse(
      pgExec(
        pgPort,
        `SELECT public.process_due_quiz_deadlines_v2(true, true)::text;`
      )
    );
    const canonicalCount = Number(
      pgExec(
        pgPort,
        `SELECT count(*) FROM public.quiz_attempts WHERE event_id = '${eventId}'::uuid;`
      )
    );
    const awardCount = Number(
      pgExec(
        pgPort,
        `SELECT count(*) FROM public.quiz_awards WHERE event_id = '${eventId}'::uuid;`
      )
    );

    if (
      !blockedBeforeReplay ||
      canonicalCount !== players.length ||
      awardCount !== 1 ||
      dupIngest.duplicates < 1
    ) {
      throw new Error(
        `E2E replay invariant failed: blocked=${blockedBeforeReplay}, attempts=${canonicalCount}, awards=${awardCount}, dup=${dupIngest.duplicates}`
      );
    }

    const summary = {
      allRoomsSealed: coordSnap.allRoomsSealed,
      ackCount,
      retryCount,
      firstIngest,
      dupIngest,
      droppedBatchId: droppedMsg.batchId,
      blockedBeforeJournalReplay: blockedBeforeReplay,
      replayIngest,
      incrementalScoringExecuted: hasIncremental > 0,
      finalScore,
      deadlines,
      canonicalAttemptCount: canonicalCount,
      awardCount,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    bridge?.server.close();
    for (const a of adapters) {
      try {
        a.close();
      } catch {
        /* noop */
      }
    }
    pgCluster?.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
