import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PackedMessageWithMetrics } from '../src/batch-packer';
import type { QuizAdmissionTicket, QuizEventConfig } from '../src/contracts';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from '../src/control-state';
import { quizAnswerKeyHash } from '../src/crypto';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { QuizRoomEngine } from '../src/room-do';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class MockDurableObject {
    protected readonly ctx: unknown;
    protected readonly env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { default: worker } = await import('../src/index');

const COORD_SECRET = 'stage3-ops-coord-secret';

function createStubNamespace(
  handler: (
    idName: string,
    path: string,
    body: unknown,
    opts?: { locationHint?: string }
  ) => unknown
) {
  return {
    idFromName: (name: string) => name,
    get: (id: string, opts?: { locationHint?: string }) => ({
      fetch: async (input: string, init?: RequestInit) => {
        if (opts?.locationHint !== 'weur') {
          throw new Error(
            `Expected locationHint='weur', got ${JSON.stringify(opts)}`
          );
        }
        const url = new URL(input);
        const body =
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        const result = handler(id, url.pathname, body, opts);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    }),
  };
}

async function makeConfig(
  eventId: string,
  nowMs: number
): Promise<QuizEventConfig> {
  const correctHash = await quizAnswerKeyHash('opt-a');
  const slotId = '00000000-0000-4000-8000-000000000001';
  return {
    eventId,
    merchantId: 'merch-ops-1',
    mode: 'live',
    contractVersion: 2,
    rulesVersion: 'live-v1',
    questionCount: 1,
    timePerQuestionSeconds: 15,
    maxAttempts: 1,
    startsAtMs: nowMs - 5_000,
    endsAtMs: nowMs + 60_000,
    status: 'active',
    retentionPeriodMs: 60_000,
    slots: [
      {
        id: slotId,
        slotIndex: 1,
        active: true,
        variants: [
          {
            id: '10000000-0000-4000-8000-000000000011',
            slotId,
            prompt: '2 + 2 = ?',
            options: [
              { id: 'opt-a', label: '4' },
              { id: 'opt-b', label: '3' },
              { id: 'opt-c', label: '5' },
              { id: 'opt-d', label: '6' },
            ],
            answerKeyHash: correctHash,
            active: true,
          },
        ],
      },
    ],
  };
}

describe('Stage 3 operational hardening', () => {
  it('replays immutable journaled batches verbatim without mutating batchId or payload', async () => {
    const published: PackedMessageWithMetrics[] = [];
    const adapter = new NodeSqliteAdapter(':memory:');
    const nowMs = 1_700_000_010_000;
    const roomId = 'evt-ops-1:room-0000';
    const controlState = new QuizControlStateStore(
      createEmptyControlState(nowMs, 1)
    );
    const engine = new QuizRoomEngine({
      roomId,
      storage: adapter,
      controlState,
      hooks: {
        onPublishBatches: async (messages) => {
          published.push(...messages);
        },
      },
    });
    engine.initialize(await makeConfig('evt-ops-1', nowMs));

    const ticket: QuizAdmissionTicket = {
      userId: 'user-1',
      customerId: 'cust-1',
      merchantId: 'merch-ops-1',
      eventId: 'evt-ops-1',
      roomId,
      deviceHash: 'a'.repeat(64),
      leaderboardUsername: 'OpsPlayer',
      expiresAtMs: nowMs + 60_000,
      admissionId: 'adm-ops-1',
      mode: 'live',
    };

    const started = engine.startAttempt({
      ticket,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-ops-1',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs,
    });
    const questionId = started.question?.id;
    expect(questionId).toBeTruthy();

    await engine.submitAnswer({
      ticket,
      attemptId: started.attemptId,
      questionId: questionId as string,
      answer: 'opt-a',
      receivedAtMs: nowMs + 1_000,
    });

    const initial = await engine.flushPendingBatches(nowMs + 2_000);
    expect(initial).toHaveLength(1);
    const originalBatch = initial[0];
    if (!originalBatch) {
      throw new Error('Expected initial flushed batch');
    }

    // Empty batchIds array is a safe no-op
    const noopRes = await engine.replayJournaledBatches([]);
    expect(noopRes).toEqual({ replayedCount: 0, batchIds: [] });
    expect(published).toHaveLength(1);

    // Filtered replay publishes the exact same serialized JSON and batchId
    const filteredRes = await engine.replayJournaledBatches([
      originalBatch.message.batchId,
    ]);
    expect(filteredRes).toEqual({
      replayedCount: 1,
      batchIds: [originalBatch.message.batchId],
    });
    expect(published).toHaveLength(2);
    expect(published[1]?.message.batchId).toBe(originalBatch.message.batchId);
    expect(published[1]?.message.seq).toBe(originalBatch.message.seq);
    expect(published[1]?.serializedJson).toBe(originalBatch.serializedJson);
    expect(published[1]?.message.payloadSha256).toBe(
      originalBatch.message.payloadSha256
    );

    // Unfiltered replay replays all journaled batches
    const allRes = await engine.replayJournaledBatches();
    expect(allRes).toEqual({
      replayedCount: 1,
      batchIds: [originalBatch.message.batchId],
    });
    expect(published).toHaveLength(3);
    expect(published[2]?.serializedJson).toBe(originalBatch.serializedJson);

    // Non-existent batchId returns zero replayed
    const missingRes = await engine.replayJournaledBatches(['non-existent']);
    expect(missingRes).toEqual({ replayedCount: 0, batchIds: [] });
    expect(published).toHaveLength(3);

    // Invalid batchIds types and oversized arrays fail with 400 QuizRoomError
    await expect(
      engine.replayJournaledBatches([123, null] as unknown as string[])
    ).rejects.toMatchObject({
      code: 'INVALID_BATCH_IDS',
      status: 400,
    });
    await expect(
      engine.replayJournaledBatches('not-an-array' as unknown as string[])
    ).rejects.toMatchObject({
      code: 'INVALID_BATCH_IDS',
      status: 400,
    });
    await expect(
      engine.replayJournaledBatches(
        Array.from({ length: 201 }, (_, i) => `b-${i}`)
      )
    ).rejects.toMatchObject({
      code: 'INVALID_BATCH_IDS',
      status: 400,
    });

    // Uninitialized / expired room returns empty without throwing
    const freshEngine = new QuizRoomEngine({
      roomId: 'evt-ops-1:room-9999',
      storage: new NodeSqliteAdapter(':memory:'),
      controlState,
    });
    expect(await freshEngine.replayJournaledBatches()).toEqual({
      replayedCount: 0,
      batchIds: [],
    });
  });

  it('enforces coordinator auth and routes /api/quiz/admin/heartbeat', async () => {
    const coordCalls: { id: string; path: string; body: unknown }[] = [];
    const env = {
      QUIZ_TICKET_SECRET: 't-sec',
      QUIZ_JWT_SECRET: 'j-sec',
      QUIZ_INTERNAL_COORDINATOR_SECRET: COORD_SECRET,
      QUIZ_ROOM: createStubNamespace(() => ({ ok: true })),
      LIVE_RANK_INDEX: createStubNamespace(() => ({ ok: true })),
      RESULT_SHARD: createStubNamespace(() => ({ ok: true })),
      EVENT_COORDINATOR: createStubNamespace((id, path, body) => {
        coordCalls.push({ id, path, body });
        const payload = body as { eventId: string; updatedAtMs: number };
        return {
          eventId: payload.eventId,
          updatedAtMs: payload.updatedAtMs,
          frozen: true,
        };
      }),
      DEMO_STATE: createStubNamespace(() => ({ ok: true })),
    };

    const unauthRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ eventId: 'evt-hb-1' }),
      }),
      env as never
    );
    expect(unauthRes.status).toBe(401);

    const badReqRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({ eventId: '   ' }),
      }),
      env as never
    );
    expect(badReqRes.status).toBe(400);

    const ts = 1_760_000_000_000;
    const okRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/heartbeat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({ eventId: 'evt-hb-1', updatedAtMs: ts }),
      }),
      env as never
    );
    expect(okRes.status).toBe(200);
    const json = (await okRes.json()) as {
      ok: boolean;
      eventId: string;
      updatedAtMs: number;
    };
    expect(json.ok).toBe(true);
    expect(json.eventId).toBe('evt-hb-1');
    expect(json.updatedAtMs).toBe(ts);
    expect(coordCalls).toEqual([
      {
        id: 'evt-hb-1',
        path: '/internal/control-state/refresh',
        body: { eventId: 'evt-hb-1', updatedAtMs: ts },
      },
    ]);
  });

  it('enforces coordinator auth and routes /api/quiz/admin/replay-batches across rooms', async () => {
    const roomCalls: { id: string; path: string; body: unknown }[] = [];
    const env = {
      QUIZ_TICKET_SECRET: 't-sec',
      QUIZ_JWT_SECRET: 'j-sec',
      QUIZ_INTERNAL_COORDINATOR_SECRET: COORD_SECRET,
      QUIZ_ROOM: createStubNamespace((id, path, body) => {
        roomCalls.push({ id, path, body });
        return { replayedCount: 2, batchIds: [`${id}:b1`, `${id}:b2`] };
      }),
      LIVE_RANK_INDEX: createStubNamespace(() => ({ ok: true })),
      RESULT_SHARD: createStubNamespace(() => ({ ok: true })),
      EVENT_COORDINATOR: createStubNamespace(() => ({ ok: true })),
      DEMO_STATE: createStubNamespace(() => ({ ok: true })),
    };

    const unauthRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/replay-batches', {
        method: 'POST',
        body: JSON.stringify({ roomId: 'evt-1:room-0000' }),
      }),
      env as never
    );
    expect(unauthRes.status).toBe(401);

    const badReqRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/replay-batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({ roomIds: [] }),
      }),
      env as never
    );
    expect(badReqRes.status).toBe(400);

    const badBatchTypesRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/replay-batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({
          roomIds: ['evt-1:room-0000'],
          batchIds: [123, null],
        }),
      }),
      env as never
    );
    expect(badBatchTypesRes.status).toBe(400);

    const tooManyBatchIdsRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/replay-batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({
          roomIds: ['evt-1:room-0000'],
          batchIds: Array.from({ length: 201 }, (_, i) => `b-${i}`),
        }),
      }),
      env as never
    );
    expect(tooManyBatchIdsRes.status).toBe(400);

    const tooManyRoomsRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/replay-batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({
          roomIds: Array.from({ length: 51 }, (_, i) => `evt-1:room-${i}`),
        }),
      }),
      env as never
    );
    expect(tooManyRoomsRes.status).toBe(400);

    const okRes = await worker.fetch(
      new Request('https://quiz.test/api/quiz/admin/replay-batches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${COORD_SECRET}` },
        body: JSON.stringify({
          roomIds: ['evt-1:room-0000', 'evt-1:room-0001'],
          batchIds: ['b-specific'],
        }),
      }),
      env as never
    );
    expect(okRes.status).toBe(200);
    const json = (await okRes.json()) as {
      ok: boolean;
      totalReplayed: number;
      rooms: { roomId: string; replayedCount: number; batchIds: string[] }[];
    };
    expect(json.ok).toBe(true);
    expect(json.totalReplayed).toBe(4);
    expect(json.rooms).toHaveLength(2);
    expect(roomCalls).toEqual([
      {
        id: 'evt-1:room-0000',
        path: '/internal/replay-batches',
        body: { batchIds: ['b-specific'] },
      },
      {
        id: 'evt-1:room-0001',
        path: '/internal/replay-batches',
        body: { batchIds: ['b-specific'] },
      },
    ]);
  });

  it('configures a dead-letter queue on the Stage 1/3 attempts queue consumer in wrangler.jsonc', () => {
    const wranglerPath = resolve(__dirname, '..', 'wrangler.jsonc');
    const config = JSON.parse(readFileSync(wranglerPath, 'utf8')) as {
      queues?: {
        consumers?: { queue: string; dead_letter_queue?: string }[];
      };
    };
    const consumer = config.queues?.consumers?.find(
      (c) => c.queue === 'baci-quiz-attempts-stage1'
    );
    expect(consumer?.dead_letter_queue).toBe('baci-quiz-attempts-stage1-dlq');
  });
});
