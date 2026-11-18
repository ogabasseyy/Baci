import { describe, expect, it } from 'vitest';
import {
  computeAttemptBundleChecksumSha256,
  QuizBatchPacker,
} from '../src/batch-packer';
import type { QuizAttemptBundle } from '../src/contracts';
import { handleDemoWorkerRoute } from '../src/demo-routes';
import { DemoStateEngine } from '../src/demo-state';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { handleQuizQueueBatch } from '../src/queue-consumer';

async function makeBundle(attemptId: string): Promise<QuizAttemptBundle> {
  const base: Omit<
    QuizAttemptBundle,
    'partIndex' | 'totalParts' | 'bundleChecksumSha256'
  > = {
    attemptId,
    admissionId: `adm-${attemptId}`,
    eventId: '11111111-1111-4111-8111-000000000001',
    merchantId: 'merch-demo',
    roomId: 'room-0000',
    userId: `u-${attemptId}`,
    customerId: `c-${attemptId}`,
    deviceHash: 'd'.repeat(64),
    leaderboardUsername: `User-${attemptId}`,
    attemptNumber: 1,
    rulesVersion: 'live-v1',
    integrityTier: 'basic',
    appVersion: '2.0.0',
    platform: 'web',
    startRequestId: `req-${attemptId}`,
    startedAtMs: 1_700_000_000_000,
    submittedAtMs: 1_700_000_010_000,
    closeReason: 'completed',
    score: 10,
    answers: [
      {
        questionId: 'q-1',
        slotId: 's-1',
        position: 1,
        variantId: 'v-1',
        optionOrder: ['opt-a', 'opt-b'],
        issuedAtMs: 1_700_000_000_000,
        receivedAtMs: 1_700_000_000_400,
        rawAnswer: 'opt-a',
        selectedAnswerHash: 'a'.repeat(64),
        answeredInMs: 400,
        timeout: false,
        scoreDelta: 1,
      },
    ],
  };
  return {
    ...base,
    partIndex: 0,
    totalParts: 1,
    bundleChecksumSha256: await computeAttemptBundleChecksumSha256(base),
  };
}

describe('Queue consumer and Demo UI / Telemetry routes', () => {
  it('handles queue() batch ingestion, duplicate ack, and transient retries', async () => {
    const packer = new QuizBatchPacker({
      eventId: '11111111-1111-4111-8111-000000000001',
      roomId: 'room-0000',
    });
    await packer.addBundle(await makeBundle('att-q1'));
    const packed1 = await packer.flush();
    if (!packed1) throw new Error('Expected packed1');

    const ackedIds: string[] = [];
    const retriedIds: string[] = [];
    let failOnce = true;
    const rpcBodies: unknown[] = [];

    const mockFetch: typeof fetch = async (_input, init) => {
      rpcBodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (failOnce) {
        failOnce = false;
        return new Response('upstream error', { status: 503 });
      }
      return new Response(
        JSON.stringify({
          ingested: true,
          duplicate: false,
          attemptsInserted: 1,
        }),
        { status: 200 }
      );
    };

    const res1 = await handleQuizQueueBatch(
      {
        queue: 'quiz-attempt-batches',
        messages: [
          {
            id: 'msg-1',
            body: packed1.message,
            ack: () => ackedIds.push('msg-1'),
            retry: () => retriedIds.push('msg-1'),
          },
          {
            id: 'msg-2',
            body: packed1.message, // duplicate within same batch
            ack: () => ackedIds.push('msg-2'),
            retry: () => retriedIds.push('msg-2'),
          },
        ],
      },
      {
        SUPABASE_URL: 'https://example.supabase.co',
        QUIZ_BATCH_WORKER_JWT: 'worker-jwt-secret',
      },
      mockFetch
    );
    expect(res1.retried).toBe(1);
    expect(res1.acked).toBe(1); // duplicate acked cleanly
    expect(res1.duplicates).toBe(1);

    // Retry msg-1 succeeds
    const res2 = await handleQuizQueueBatch(
      {
        queue: 'quiz-attempt-batches',
        messages: [
          {
            id: 'msg-1',
            body: packed1.message,
            ack: () => ackedIds.push('msg-1-retry'),
            retry: () => retriedIds.push('msg-1-retry'),
          },
        ],
      },
      {
        SUPABASE_URL: 'https://example.supabase.co',
        QUIZ_BATCH_WORKER_JWT: 'worker-jwt-secret',
      },
      mockFetch
    );
    expect(res2.acked).toBe(1);
    expect(res2.attemptsIngested).toBe(1);
    expect(rpcBodies).toHaveLength(2);
  });

  it('serves /demo, gates admin setup-round, mints check-in tokens, and aggregates /demo/report per carrier', async () => {
    const adapter = new NodeSqliteAdapter(':memory:');
    const demoState = new DemoStateEngine(adapter);
    const initializedRooms: string[] = [];

    const dispatchEnv = {
      QUIZ_TICKET_SECRET: 'demo-ticket-secret',
      QUIZ_JWT_SECRET: 'demo-jwt-secret',
      QUIZ_INTERNAL_COORDINATOR_SECRET: 'demo-admin-secret',
      callDemoDo: (path: string, body?: unknown) => {
        if (path === '/internal/demo/setup-round') {
          demoState.setActiveRound(body as never);
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true, ...(body as object) }))
          );
        }
        if (path === '/internal/demo/check-in') {
          const alloc = demoState.allocateCheckIn(
            (body as { roomId?: string })?.roomId
          );
          return Promise.resolve(new Response(JSON.stringify(alloc)));
        }
        if (path === '/internal/demo/telemetry') {
          demoState.recordTelemetry(body as never);
          return Promise.resolve(new Response(JSON.stringify({ ok: true })));
        }
        if (path === '/internal/demo/report') {
          return Promise.resolve(
            new Response(JSON.stringify(demoState.buildReport()))
          );
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      },
      initRoom: (roomId: string) => {
        initializedRooms.push(roomId);
        return Promise.resolve();
      },
      freezeCoordinator: () => Promise.resolve(),
    };

    const pageRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/demo'),
      new URL('https://demo.test/demo'),
      dispatchEnv
    );
    expect(pageRes?.status).toBe(200);
    expect(await pageRes?.text()).toContain('Baci Quiz');

    // Admin setup-round fails closed without valid coordinator secret
    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/admin/setup-round', {
          method: 'POST',
          body: JSON.stringify({ round: 3 }),
        }),
        new URL('https://demo.test/api/demo/admin/setup-round'),
        dispatchEnv
      )
    ).rejects.toMatchObject({ code: 'QUIZ_AUTH_REQUIRED' });

    const setupRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/admin/setup-round', {
        method: 'POST',
        headers: { Authorization: 'Bearer demo-admin-secret' },
        body: JSON.stringify({ round: 3 }),
      }),
      new URL('https://demo.test/api/demo/admin/setup-round'),
      dispatchEnv
    );
    expect(setupRes?.status).toBe(200);
    expect(initializedRooms).toHaveLength(13);

    const checkInRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/check-in', {
        method: 'POST',
        body: JSON.stringify({ carrier: 'MTN', nickname: 'AdaNG' }),
      }),
      new URL('https://demo.test/api/demo/check-in'),
      dispatchEnv
    );
    expect(checkInRes?.status).toBe(200);
    const checkInJson = (await checkInRes?.json()) as {
      roomId: string;
      ticket: string;
      bearerToken: string;
    };
    expect(checkInJson.roomId).toBe('room-0000');
    expect(checkInJson.ticket.startsWith('bqt1.')).toBe(true);

    for (const ms of [120, 240, 880, 1250]) {
      await handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          body: JSON.stringify({
            carrier: 'MTN',
            tapToAckMs: ms,
            retries: ms > 1000 ? 1 : 0,
          }),
        }),
        new URL('https://demo.test/api/demo/telemetry'),
        dispatchEnv
      );
    }

    const reportJsonRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/demo/report?format=json'),
      new URL('https://demo.test/demo/report?format=json'),
      dispatchEnv
    );
    const report = (await reportJsonRes?.json()) as {
      totalSamples: number;
      carriers: { carrier: string; under1sRatePct: number; p95Ms: number }[];
    };
    expect(report.totalSamples).toBe(4);
    expect(report.carriers[0]?.carrier).toBe('MTN');
    expect(report.carriers[0]?.under1sRatePct).toBe(75);
    expect(report.carriers[0]?.p95Ms).toBe(1250);

    const reportHtmlRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/demo/report'),
      new URL('https://demo.test/demo/report'),
      dispatchEnv
    );
    expect(await reportHtmlRes?.text()).toContain('MTN');
    adapter.close();
  });
});
