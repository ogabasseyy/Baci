import { describe, expect, it, vi } from 'vitest';
import type { QuizAdmissionTicket } from '../src/contracts';
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

const { default: worker } = await import('../src/index');

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
    const resultRes = await worker.fetch(
      new Request(
        'https://quiz.example.com/api/quiz/attempts/att-1/result?eventId=evt-r1',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${bearerJwt}` },
        }
      ),
      env as never
    );
    expect(resultRes.status).toBe(200);
    expect(calls[3]?.ns).toBe('RESULT_SHARD');
    expect(calls[3]?.id.startsWith('evt-r1:shard:')).toBe(true);
    expect(calls[3]?.path).toBe('/internal/result');

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
    expect(calls[4]?.ns).toBe('RESULT_SHARD');
    expect(calls[4]?.id).toBe(calls[3]?.id);
    expect(calls[4]?.path).toBe('/internal/leaderboard');

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
});
