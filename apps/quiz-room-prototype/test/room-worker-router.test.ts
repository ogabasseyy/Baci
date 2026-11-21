import { describe, expect, it, vi } from 'vitest';
import type { QuizAdmissionTicket } from '../src/contracts';
import { quizAnswerKeyHash } from '../src/crypto';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { computeResultShardIndex } from '../src/result-shard';
import { QuizRoomEngine } from '../src/room-do';
import { signAdmissionTicket, signBearerJwt } from '../src/ticket';

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

const {
  default: worker,
  QuizRoomDO,
  LiveRankIndexDO,
  EventCoordinatorDO,
} = await import('../src/index');

const TICKET_SECRET = 'router-ticket-secret';
const JWT_SECRET = 'router-jwt-secret';

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

describe('Worker HTTP router (src/index.ts)', () => {
  it('routes play requests by signed ticket and post-event reads by bearer JWT + deterministic result shard', async () => {
    const calls: { ns: string; id: string; path: string; body?: unknown }[] =
      [];
    const env = {
      QUIZ_TICKET_SECRET: TICKET_SECRET,
      QUIZ_JWT_SECRET: JWT_SECRET,
      QUIZ_INTERNAL_COORDINATOR_SECRET: 'coord-secret-123',
      RESULT_SHARD_COUNT: '16',
      QUIZ_ROOM: createStubNamespace((id, path, body) => {
        calls.push({ ns: 'QUIZ_ROOM', id, path, body });
        return { ok: true, id, path };
      }),
      LIVE_RANK_INDEX: createStubNamespace((id, path, body) => {
        calls.push({ ns: 'LIVE_RANK_INDEX', id, path, body });
        return {
          status: 'live',
          entries: [],
          currentPlayer: null,
          participantCount: 0,
        };
      }),
      RESULT_SHARD: createStubNamespace((id, path, body) => {
        calls.push({ ns: 'RESULT_SHARD', id, path, body });
        return {
          status: 'published',
          entries: [],
          currentPlayer: null,
          participantCount: 1,
        };
      }),
      EVENT_COORDINATOR: createStubNamespace((id, path, body) => {
        calls.push({ ns: 'EVENT_COORDINATOR', id, path, body });
        return { ok: true };
      }),
      DEMO_STATE: createStubNamespace((id, path, body) => {
        calls.push({ ns: 'DEMO_STATE', id, path, body });
        return { ok: true };
      }),
    };

    const nowMs = Date.now();
    const ticket: QuizAdmissionTicket = {
      userId: 'user-r1',
      customerId: 'cust-r1',
      merchantId: 'merch-1',
      eventId: 'evt-r1',
      roomId: 'room-42',
      deviceHash: 'a'.repeat(64),
      leaderboardUsername: 'RouterPlayer',
      expiresAtMs: nowMs + 60_000,
    };
    const signedTicket = await signAdmissionTicket(ticket, TICKET_SECRET);
    const bearerJwt = await signBearerJwt(
      {
        sub: 'user-r1',
        merchantId: 'merch-from-jwt',
        customerId: 'cust-from-jwt',
        exp: Math.floor((nowMs + 3_600_000) / 1000),
      },
      JWT_SECRET
    );
    const jwtMissingClaims = await signBearerJwt(
      { sub: 'user-r1', exp: Math.floor((nowMs + 3_600_000) / 1000) },
      JWT_SECRET
    );

    const startRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/events/evt-r1/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Ticket': signedTicket,
        },
        body: JSON.stringify({
          integrityTier: 'strong',
          acceptedRulesVersion: 'live-v1',
          termsAccepted: true,
          startRequestId: '11111111-1111-4111-8111-111111111111',
          appVersion: '2.0.0',
          platform: 'ios',
        }),
      }),
      env as never
    );
    expect(startRes.status).toBe(200);
    expect(calls[0]).toMatchObject({
      ns: 'QUIZ_ROOM',
      id: 'room-42',
      path: '/internal/start',
    });

    const badStartRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/events/evt-r1/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Ticket': signedTicket,
        },
        body: JSON.stringify({
          integrityTier: 'strong',
          acceptedRulesVersion: 'live-v1',
          termsAccepted: true,
          startRequestId: 'not-a-uuid',
          appVersion: '2.0.0',
          platform: 'ios',
        }),
      }),
      env as never
    );
    expect(badStartRes.status).toBe(400);
    expect((await badStartRes.json()) as { code: string }).toMatchObject({
      code: 'QUIZ_INVALID_INPUT',
    });

    const ansRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/attempts/att-1/answers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Baci-Quiz-Ticket': signedTicket,
        },
        body: JSON.stringify({ questionId: 'q-1', answer: 'opt-a' }),
      }),
      env as never
    );
    expect(ansRes.status).toBe(200);
    expect(calls[1]).toMatchObject({
      ns: 'QUIZ_ROOM',
      id: 'room-42',
      path: '/internal/answer',
    });

    const activeRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/attempts/att-1/active', {
        method: 'GET',
        headers: { 'X-Baci-Quiz-Ticket': signedTicket },
      }),
      env as never
    );
    expect(activeRes.status).toBe(200);
    expect(calls[2]).toMatchObject({
      ns: 'QUIZ_ROOM',
      id: 'room-42',
      path: '/internal/resume',
    });

    // Returning player result & published leaderboard WITHOUT play ticket (bearer JWT only!)
    // Attempt URL carries NO eventId; routes by hash(attemptId, userId) mod S.
    const expectedAttemptShard = await computeResultShardIndex(
      'att-1',
      'user-r1',
      16
    );
    const expectedEventShard = await computeResultShardIndex(
      'evt-r1',
      'user-r1',
      16
    );

    const resultRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/attempts/att-1/result', {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerJwt}` },
      }),
      env as never
    );
    expect(resultRes.status).toBe(200);
    expect(calls[3]).toMatchObject({
      ns: 'RESULT_SHARD',
      id: `attempt-shard:${expectedAttemptShard}`,
      path: '/internal/result',
    });

    const boardRes = await worker.fetch(
      new Request(
        'https://quiz.example.com/api/quiz/leaderboard?eventId=evt-r1',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearerJwt}` },
        }
      ),
      env as never
    );
    expect(boardRes.status).toBe(200);
    expect(calls[4]).toMatchObject({
      ns: 'RESULT_SHARD',
      id: `evt-r1:shard:${expectedEventShard}`,
      path: '/internal/leaderboard',
    });

    const liveRes = await worker.fetch(
      new Request(
        'https://quiz.example.com/api/quiz/leaderboard/live?eventId=evt-r1&merchantId=spoofed&customerId=spoofed',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearerJwt}` },
        }
      ),
      env as never
    );
    expect(liveRes.status).toBe(200);
    expect(calls[5]).toEqual({
      ns: 'LIVE_RANK_INDEX',
      id: 'evt-r1',
      path: '/internal/leaderboard',
      body: {
        eventId: 'evt-r1',
        merchantId: 'merch-from-jwt',
        callerCustomerId: 'cust-from-jwt',
        callerUserId: 'user-r1',
      },
    });

    // Live leaderboard rejects JWT missing merchantId/customerId claims
    const liveMissingRes = await worker.fetch(
      new Request(
        'https://quiz.example.com/api/quiz/leaderboard/live?eventId=evt-r1',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${jwtMissingClaims}` },
        }
      ),
      env as never
    );
    expect(liveMissingRes.status).toBe(403);

    // Coordinator routes fail closed without QUIZ_INTERNAL_COORDINATOR_SECRET or bad Bearer
    const badCoordRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/coordinator/sweep', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-secret' },
        body: JSON.stringify({ eventId: 'evt-r1' }),
      }),
      env as never
    );
    expect(badCoordRes.status).toBe(403);

    const okCoordRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/coordinator/sweep', {
        method: 'POST',
        headers: { Authorization: 'Bearer coord-secret-123' },
        body: JSON.stringify({ eventId: 'evt-r1' }),
      }),
      env as never
    );
    expect(okCoordRes.status).toBe(200);

    // Unconfigured secrets fail closed with 503 QUIZ_CONFIG_MISSING
    const unconfiguredRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/events/evt-r1/start', {
        method: 'POST',
        headers: { 'X-Baci-Quiz-Ticket': signedTicket },
        body: JSON.stringify({}),
      }),
      { ...env, QUIZ_TICKET_SECRET: '' } as never
    );
    expect(unconfiguredRes.status).toBe(503);
    expect(await unconfiguredRes.json()).toMatchObject({
      code: 'QUIZ_CONFIG_MISSING',
    });

    const statusRes = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/events/evt-r1/status', {
        method: 'GET',
      }),
      env as never
    );
    expect(statusRes.status).toBe(200);
    expect(statusRes.headers.get('Cache-Control')).toContain('max-age=');
  });

  it('initializes QuizRoomDO with ctx.id.name (not hex toString), fresh control state, and strictly synchronous transactionSync', async () => {
    const adapter = new NodeSqliteAdapter(':memory:');
    let syncViolation = false;
    const strictSyncStorage = {
      sql: {
        exec: (query: string, ...bindings: unknown[]) => {
          const res = adapter.exec(query, ...(bindings as never[]));
          return {
            toArray: () => res.rows,
            rowsRead: res.rowsRead,
            rowsWritten: res.rowsWritten,
          };
        },
      },
      transactionSync: <T>(fn: () => T): T => {
        const result = adapter.transactionSync(fn);
        if (
          result &&
          typeof result === 'object' &&
          'then' in (result as Record<string, unknown>)
        ) {
          syncViolation = true;
          throw new Error(
            'transactionSync closure must be strictly synchronous!'
          );
        }
        return result;
      },
      getAlarm: () => Promise.resolve(adapter.getAlarm()),
      setAlarm: (ms: number | Date) => {
        adapter.setAlarm(typeof ms === 'number' ? ms : ms.getTime());
        return Promise.resolve();
      },
      deleteAlarm: () => {
        adapter.deleteAlarm();
        return Promise.resolve();
      },
      deleteAll: () => {
        adapter.deleteAll();
        return Promise.resolve();
      },
    };

    const doInstance = new QuizRoomDO(
      {
        id: {
          name: 'room-42',
          toString: () => 'f'.repeat(64),
        },
        storage: strictSyncStorage,
      } as never,
      {} as never
    );

    const correctHash = await quizAnswerKeyHash('opt-a');
    const nowMs = Date.now();
    const config = {
      eventId: 'evt-do-1',
      merchantId: 'merch-1',
      mode: 'live' as const,
      contractVersion: 2 as const,
      rulesVersion: 'live-v1',
      questionCount: 1,
      timePerQuestionSeconds: 10,
      maxAttempts: 1,
      startsAtMs: nowMs - 5_000,
      endsAtMs: nowMs + 60_000,
      status: 'active' as const,
      slots: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          slotIndex: 1,
          active: true,
          variants: [
            {
              id: '10000000-0000-4000-8000-000000000001',
              slotId: '00000000-0000-4000-8000-000000000001',
              prompt: 'Q1?',
              options: [
                { id: 'opt-a', label: 'A' },
                { id: 'opt-b', label: 'B' },
              ],
              answerKeyHash: correctHash,
              active: true,
            },
          ],
        },
      ],
    };

    const initRes = await doInstance.fetch(
      new Request('https://room.internal/internal/init', {
        method: 'POST',
        body: JSON.stringify(config),
      })
    );
    expect(initRes.status).toBe(200);
    expect(await initRes.json()).toEqual({ ok: true, roomId: 'room-42' });

    const ticket: QuizAdmissionTicket = {
      userId: 'user-do-1',
      customerId: 'cust-do-1',
      merchantId: 'merch-1',
      eventId: 'evt-do-1',
      roomId: 'room-42',
      deviceHash: 'a'.repeat(64),
      leaderboardUsername: 'DoPlayer',
      expiresAtMs: nowMs + 120_000,
    };

    const startRes = await doInstance.fetch(
      new Request('https://room.internal/internal/start', {
        method: 'POST',
        body: JSON.stringify({
          ticket,
          integrityTier: 'strong',
          acceptedRulesVersion: 'live-v1',
          termsAccepted: true,
          startRequestId: 'req-do-1',
          appVersion: '2.0.0',
          platform: 'ios',
        }),
      })
    );
    expect(startRes.status).toBe(200);
    const started = (await startRes.json()) as {
      attemptId: string;
      status: string;
      question?: { id: string };
    };
    expect(started.status).toBe('in_progress');
    expect(started.question?.id).toBeDefined();

    // Answer Q1 and seal (exercises flushPendingBatches with strictly synchronous transactionSync)
    const ansRes = await doInstance.fetch(
      new Request('https://room.internal/internal/answer', {
        method: 'POST',
        body: JSON.stringify({
          ticket,
          attemptId: started.attemptId,
          questionId: started.question?.id,
          answer: 'opt-a',
        }),
      })
    );
    expect(ansRes.status).toBe(200);

    const sealRes = await doInstance.fetch(
      new Request('https://room.internal/internal/seal', {
        method: 'POST',
        body: JSON.stringify({
          eventId: 'evt-do-1',
          persistedCloseAtMs: nowMs + 60_500,
          mode: 'persisted_close',
          endsAtMs: nowMs + 60_000,
        }),
      })
    );
    expect(sealRes.status).toBe(200);
    expect(syncViolation).toBe(false);

    // Also verify QuizRoomEngine flushPendingBatches passes strict sync check directly
    const engine = new QuizRoomEngine({ roomId: 'r-sync', storage: adapter });
    expect(engine.getSealManifest()?.attemptCount).toBe(1);
    adapter.close();
  });

  it('pulls fresh control state from EventCoordinatorDO when QuizRoomDO restarts or goes stale, and fails closed when coordinator is also stale', async () => {
    const roomAdapter = new NodeSqliteAdapter(':memory:');
    const coordAdapter = new NodeSqliteAdapter(':memory:');

    const wrapAdapter = (ad: NodeSqliteAdapter) => ({
      sql: {
        exec: (query: string, ...bindings: unknown[]) => {
          const res = ad.exec(query, ...(bindings as never[]));
          return {
            toArray: () => res.rows,
            rowsRead: res.rowsRead,
            rowsWritten: res.rowsWritten,
          };
        },
      },
      transactionSync: <T>(fn: () => T): T => ad.transactionSync(fn),
      getAlarm: () => Promise.resolve(ad.getAlarm()),
      setAlarm: (ms: number | Date) => {
        ad.setAlarm(typeof ms === 'number' ? ms : ms.getTime());
        return Promise.resolve();
      },
      deleteAlarm: () => {
        ad.deleteAlarm();
        return Promise.resolve();
      },
      deleteAll: () => {
        ad.deleteAll();
        return Promise.resolve();
      },
    });

    const coordDo = new EventCoordinatorDO(
      {
        id: { name: 'evt-cs-1', toString: () => 'c'.repeat(64) },
        storage: wrapAdapter(coordAdapter),
      } as never,
      {} as never
    );

    const workerEnv = {
      QUIZ_INTERNAL_COORDINATOR_SECRET: 'coord-secret-cs',
      EVENT_COORDINATOR: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: (input: string, init?: RequestInit) =>
            coordDo.fetch(new Request(input, init)),
        }),
      },
    };

    const nowMs = Date.now();
    const correctHash = await quizAnswerKeyHash('opt-a');
    const config = {
      eventId: 'evt-cs-1',
      merchantId: 'merch-1',
      mode: 'live' as const,
      contractVersion: 2 as const,
      rulesVersion: 'live-v1',
      questionCount: 1,
      timePerQuestionSeconds: 10,
      maxAttempts: 1,
      startsAtMs: nowMs - 5_000,
      endsAtMs: nowMs + 60_000,
      status: 'active' as const,
      slots: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          slotIndex: 1,
          active: true,
          variants: [
            {
              id: '10000000-0000-4000-8000-000000000001',
              slotId: '00000000-0000-4000-8000-000000000001',
              prompt: 'Q1?',
              options: [
                { id: 'opt-a', label: 'A' },
                { id: 'opt-b', label: 'B' },
              ],
              answerKeyHash: correctHash,
              active: true,
            },
          ],
        },
      ],
    };

    // Init room on instance 1
    const room1 = new QuizRoomDO(
      {
        id: { name: 'room-cs-1', toString: () => 'a'.repeat(64) },
        storage: wrapAdapter(roomAdapter),
      } as never,
      workerEnv as never
    );
    await room1.fetch(
      new Request('https://room.internal/internal/init', {
        method: 'POST',
        body: JSON.stringify(config),
      })
    );

    // Push STALE snapshot (120s old) to EventCoordinatorDO via authenticated admin route
    const stalePush = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/admin/control-state', {
        method: 'POST',
        headers: { Authorization: 'Bearer coord-secret-cs' },
        body: JSON.stringify({
          eventId: 'evt-cs-1',
          snapshot: {
            version: 1,
            updatedAtMs: nowMs - 120_000,
            cancelledEvents: {},
            blockedAttemptIds: [],
            blockedCustomerKeys: [],
            revokedTesterKeys: [],
            disqualifiedAttemptIds: [],
            suppressedAttemptIds: [],
            deletedCustomerIds: [],
            publishedEvents: {},
          },
        }),
      }),
      workerEnv as never
    );
    expect(stalePush.status).toBe(200);

    // Simulate QuizRoomDO restart/hibernation (fresh in-memory controlState at updatedAtMs=0)
    const restartedRoom = new QuizRoomDO(
      {
        id: { name: 'room-cs-1', toString: () => 'a'.repeat(64) },
        storage: wrapAdapter(roomAdapter),
      } as never,
      workerEnv as never
    );

    const startBody = {
      ticket: {
        userId: 'user-cs-1',
        customerId: 'cust-cs-1',
        merchantId: 'merch-1',
        eventId: 'evt-cs-1',
        roomId: 'room-cs-1',
        deviceHash: 'b'.repeat(64),
        leaderboardUsername: 'CsPlayer',
        expiresAtMs: nowMs + 120_000,
      },
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-cs-1',
      appVersion: '2.0.0',
      platform: 'ios',
    };

    // Coordinator snapshot is ALSO stale -> MUST fail closed with 503 QUIZ_CONTROL_STATE_STALE
    const failRes = await restartedRoom.fetch(
      new Request('https://room.internal/internal/start', {
        method: 'POST',
        body: JSON.stringify(startBody),
      })
    );
    expect(failRes.status).toBe(503);
    expect(await failRes.json()).toMatchObject({
      code: 'QUIZ_CONTROL_STATE_STALE',
    });

    // Push FRESH snapshot (version 2, updatedAtMs = nowMs) -> restartedRoom pulls & succeeds!
    const freshPush = await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/admin/control-state', {
        method: 'POST',
        headers: { Authorization: 'Bearer coord-secret-cs' },
        body: JSON.stringify({
          eventId: 'evt-cs-1',
          snapshot: {
            version: 2,
            updatedAtMs: Date.now(),
            cancelledEvents: {},
            blockedAttemptIds: [],
            blockedCustomerKeys: [],
            revokedTesterKeys: [],
            disqualifiedAttemptIds: [],
            suppressedAttemptIds: [],
            deletedCustomerIds: [],
            publishedEvents: {},
          },
        }),
      }),
      workerEnv as never
    );
    expect(freshPush.status).toBe(200);

    const okRes = await restartedRoom.fetch(
      new Request('https://room.internal/internal/start', {
        method: 'POST',
        body: JSON.stringify(startBody),
      })
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ status: 'in_progress' });

    roomAdapter.close();
    coordAdapter.close();
  });

  it('batches QuizRoomDO live scoreboard completions into 1 /internal/submit-batch DO call without duplicate ticks', async () => {
    const roomAdapter = new NodeSqliteAdapter(':memory:');
    const rankAdapter = new NodeSqliteAdapter(':memory:');
    const coordAdapter = new NodeSqliteAdapter(':memory:');
    const nowMs = Date.now();
    const startsAtMs = nowMs - 1_000;
    const endsAtMs = nowMs + 120_000;
    const rankFetches: string[] = [];
    let currentAlarm: number | null = null;

    const wrapAdapter = (adapter: NodeSqliteAdapter) => ({
      sql: {
        exec: (q: string, ...b: unknown[]) => {
          const res = adapter.exec(q, ...(b as never[]));
          return {
            toArray: () => res.rows,
            rowsRead: res.rowsRead,
            rowsWritten: res.rowsWritten,
          };
        },
      },
      transactionSync: <T>(fn: () => T) => adapter.transactionSync(fn),
      getAlarm: () => Promise.resolve(currentAlarm),
      setAlarm: (ms: number | Date) => {
        currentAlarm = typeof ms === 'number' ? ms : ms.getTime();
        return Promise.resolve();
      },
      deleteAlarm: () => {
        currentAlarm = null;
        return Promise.resolve();
      },
      deleteAll: () => Promise.resolve(),
    });

    let liveRankDo!: InstanceType<typeof LiveRankIndexDO>;
    const workerEnv = {
      QUIZ_TICKET_SECRET: TICKET_SECRET,
      QUIZ_JWT_SECRET: JWT_SECRET,
      QUIZ_INTERNAL_COORDINATOR_SECRET: 'coord-secret-batch',
      RESULT_SHARD_COUNT: '4',
      QUIZ_ROOM: createStubNamespace(() => ({ ok: true })),
      LIVE_RANK_INDEX: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: (input: string, init?: RequestInit) => {
            rankFetches.push(new URL(input).pathname);
            return liveRankDo.fetch(new Request(input, init));
          },
        }),
      },
      RESULT_SHARD: createStubNamespace(() => ({ ok: true })),
      EVENT_COORDINATOR: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: (input: string, init?: RequestInit) =>
            coordDo.fetch(new Request(input, init)),
        }),
      },
      DEMO_STATE: createStubNamespace(() => ({ ok: true })),
    };

    liveRankDo = new LiveRankIndexDO(
      {
        id: { name: 'evt-batch-1', toString: () => 'r'.repeat(64) },
        storage: wrapAdapter(rankAdapter),
      } as never,
      workerEnv as never
    );
    const coordDo = new EventCoordinatorDO(
      {
        id: { name: 'evt-batch-1', toString: () => 'c'.repeat(64) },
        storage: wrapAdapter(coordAdapter),
      } as never,
      workerEnv as never
    );
    const roomDo = new QuizRoomDO(
      {
        id: { name: 'evt-batch-1:room-0000', toString: () => 'q'.repeat(64) },
        storage: wrapAdapter(roomAdapter),
      } as never,
      workerEnv as never
    );

    await worker.fetch(
      new Request('https://quiz.example.com/api/quiz/admin/control-state', {
        method: 'POST',
        headers: { Authorization: 'Bearer coord-secret-batch' },
        body: JSON.stringify({
          eventId: 'evt-batch-1',
          snapshot: {
            version: 1,
            updatedAtMs: nowMs,
            cancelledEvents: {},
            blockedAttemptIds: [],
            blockedCustomerKeys: [],
            revokedTesterKeys: [],
            disqualifiedAttemptIds: [],
            suppressedAttemptIds: [],
            deletedCustomerIds: [],
            publishedEvents: {},
          },
        }),
      }),
      workerEnv as never
    );

    const answerHash = await quizAnswerKeyHash('opt-a');
    await roomDo.fetch(
      new Request('https://room.internal/internal/init', {
        method: 'POST',
        body: JSON.stringify({
          eventId: 'evt-batch-1',
          merchantId: 'merch-1',
          mode: 'live',
          contractVersion: 2,
          rulesVersion: 'live-v1',
          questionCount: 2,
          timePerQuestionSeconds: 10,
          maxAttempts: 1,
          startsAtMs,
          endsAtMs,
          scoreboardTickMs: 1_000,
          flushTickMs: 60_000,
          status: 'active',
          slots: [1, 2].map((qNum) => ({
            id: `00000000-0000-4000-8000-${String(qNum).padStart(12, '0')}`,
            slotIndex: qNum,
            active: true,
            variants: [
              {
                id: `10000000-0000-4000-8000-${String(qNum).padStart(12, '0')}`,
                slotId: `00000000-0000-4000-8000-${String(qNum).padStart(12, '0')}`,
                prompt: `Q${qNum}`,
                options: [
                  { id: 'opt-a', label: 'A' },
                  { id: 'opt-b', label: 'B' },
                ],
                answerKeyHash: answerHash,
                active: true,
              },
            ],
          })),
        }),
      })
    );

    const completePlayer = async (idx: number) => {
      const ticket: QuizAdmissionTicket = {
        userId: `u-b-${idx}`,
        customerId: `c-b-${idx}`,
        merchantId: 'merch-1',
        eventId: 'evt-batch-1',
        roomId: 'evt-batch-1:room-0000',
        deviceHash: String(idx).padStart(64, '0'),
        leaderboardUsername: `BatchPlayer${idx}`,
        expiresAtMs: endsAtMs + 60_000,
      };
      const startRes = await roomDo.fetch(
        new Request('https://room.internal/internal/start', {
          method: 'POST',
          body: JSON.stringify({
            ticket,
            integrityTier: 'basic',
            acceptedRulesVersion: 'live-v1',
            termsAccepted: true,
            startRequestId: `req-b-${idx}`,
            appVersion: '1.0',
            platform: 'web',
          }),
        })
      );
      let state = (await startRes.json()) as {
        attemptId: string;
        question?: { id: string };
      };
      for (let q = 0; q < 2; q += 1) {
        const ansRes = await roomDo.fetch(
          new Request('https://room.internal/internal/answer', {
            method: 'POST',
            body: JSON.stringify({
              ticket,
              attemptId: state.attemptId,
              questionId: state.question?.id ?? '',
              answer: q < idx ? 'opt-a' : 'opt-b',
            }),
          })
        );
        state = (await ansRes.json()) as typeof state;
      }
    };

    await completePlayer(1);
    await completePlayer(2);

    // Wait past scoreboardTickMs (1_000ms) and trigger public roomDo.alarm() entrypoint
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(baseNow + 2_000);
      await roomDo.alarm();
      expect(rankFetches).toEqual(['/internal/submit-batch']);

      // Second alarm sends 0 duplicate submissions
      nowSpy.mockReturnValue(baseNow + 5_000);
      await roomDo.alarm();
      expect(rankFetches).toEqual(['/internal/submit-batch']);
    } finally {
      nowSpy.mockRestore();
    }

    // /api/quiz/leaderboard/live reflects both players from that single batched DO call
    const bearer = await signBearerJwt(
      {
        sub: 'u-b-2',
        merchantId: 'merch-1',
        customerId: 'c-b-2',
        exp: Math.floor((endsAtMs + 3_600_000) / 1000),
      },
      JWT_SECRET
    );
    const liveRes = await worker.fetch(
      new Request(
        'https://quiz.example.com/api/quiz/leaderboard/live?eventId=evt-batch-1',
        { headers: { Authorization: `Bearer ${bearer}` } }
      ),
      workerEnv as never
    );
    expect(liveRes.status).toBe(200);
    const liveJson = (await liveRes.json()) as {
      participantCount: number;
      entries: { rank: number; displayName: string; score: number }[];
    };
    expect(liveJson.participantCount).toBe(2);
    expect(liveJson.entries[0]).toMatchObject({
      rank: 1,
      displayName: 'BatchPlayer2',
      score: 2,
    });
    expect(rankFetches).toEqual([
      '/internal/submit-batch',
      '/internal/leaderboard',
    ]);

    roomAdapter.close();
    rankAdapter.close();
    coordAdapter.close();
  });
});
