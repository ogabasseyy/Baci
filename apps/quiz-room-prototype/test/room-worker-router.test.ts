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

const { default: worker, QuizRoomDO } = await import('../src/index');

const TICKET_SECRET = 'router-ticket-secret';
const JWT_SECRET = 'router-jwt-secret';

function createStubNamespace(
  handler: (idName: string, path: string, body: unknown) => unknown
) {
  return {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        const body =
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        const result = handler(id, url.pathname, body);
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
    const calls: { ns: string; id: string; path: string }[] = [];
    const env = {
      QUIZ_TICKET_SECRET: TICKET_SECRET,
      QUIZ_JWT_SECRET: JWT_SECRET,
      RESULT_SHARD_COUNT: '16',
      QUIZ_ROOM: createStubNamespace((id, path) => {
        calls.push({ ns: 'QUIZ_ROOM', id, path });
        return { ok: true, id, path };
      }),
      LIVE_RANK_INDEX: createStubNamespace((id, path) => {
        calls.push({ ns: 'LIVE_RANK_INDEX', id, path });
        return {
          status: 'live',
          entries: [],
          currentPlayer: null,
          participantCount: 0,
        };
      }),
      RESULT_SHARD: createStubNamespace((id, path) => {
        calls.push({ ns: 'RESULT_SHARD', id, path });
        return {
          status: 'published',
          entries: [],
          currentPlayer: null,
          participantCount: 1,
        };
      }),
      EVENT_COORDINATOR: createStubNamespace((id, path) => {
        calls.push({ ns: 'EVENT_COORDINATOR', id, path });
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
          startRequestId: 'req-r1',
          appVersion: '2.0.0',
          platform: 'ios',
        }),
      }),
      env as never
    );
    expect(startRes.status).toBe(200);
    expect(calls[0]).toEqual({
      ns: 'QUIZ_ROOM',
      id: 'room-42',
      path: '/internal/start',
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
    expect(calls[1]).toEqual({
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
    expect(calls[2]).toEqual({
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
    expect(calls[3]).toEqual({
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
    expect(calls[4]).toEqual({
      ns: 'RESULT_SHARD',
      id: `evt-r1:shard:${expectedEventShard}`,
      path: '/internal/leaderboard',
    });

    const liveRes = await worker.fetch(
      new Request(
        'https://quiz.example.com/api/quiz/leaderboard/live?eventId=evt-r1&merchantId=merch-1',
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
});
