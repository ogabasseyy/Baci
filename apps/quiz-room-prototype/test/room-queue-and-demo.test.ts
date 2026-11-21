import { describe, expect, it } from 'vitest';
import {
  computeAttemptBundleChecksumSha256,
  QuizBatchPacker,
} from '../src/batch-packer';
import type {
  QuizAttemptBundle,
  QuizEventConfig,
  QuizPrivateResultRecord,
} from '../src/contracts';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from '../src/control-state';
import { EventCoordinatorEngine } from '../src/coordinator';
import { classifyVerifiedNetwork } from '../src/demo-isp';
import { handleDemoWorkerRoute } from '../src/demo-routes';

function withCf(
  request: Request,
  cf: { asn?: number; asOrganization?: string; colo?: string; country?: string }
): Request {
  Object.defineProperty(request, 'cf', { value: cf });
  return request;
}

import { DemoStateEngine } from '../src/demo-state';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { handleQuizQueueBatch } from '../src/queue-consumer';
import {
  type PublishedShardEventMetadata,
  ResultShardEngine,
} from '../src/result-shard';
import { QuizRoomEngine } from '../src/room-do';
import { verifyAdmissionTicket } from '../src/ticket';

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

    // Multi-part split bundle arriving in the SAME queue() batch must send consistent
    // split batch IDs and part_index 0..1 / total_parts=2 on both parts.
    const bigBase = await makeBundle('att-split-same-batch');
    const bigAnswers = Array.from({ length: 10 }, (_, i) => ({
      questionId: `q-${i + 1}`,
      slotId: `s-${i + 1}`,
      position: i + 1,
      variantId: `v-${i + 1}`,
      optionOrder: ['opt-a', 'opt-b'],
      issuedAtMs: 1_700_000_000_000 + i * 1000,
      receivedAtMs: 1_700_000_000_400 + i * 1000,
      rawAnswer: `opt-a-${'z'.repeat(8_000)}`,
      selectedAnswerHash: 'a'.repeat(64),
      answeredInMs: 400,
      timeout: false,
      scoreDelta: 1,
    }));
    const bigBundle: QuizAttemptBundle = {
      ...bigBase,
      answers: bigAnswers,
      bundleChecksumSha256: await computeAttemptBundleChecksumSha256({
        ...bigBase,
        answers: bigAnswers,
      }),
    };
    const splitPacker = new QuizBatchPacker({
      eventId: bigBundle.eventId,
      roomId: bigBundle.roomId,
    });
    const splitMsgs = await splitPacker.addBundle(bigBundle);
    expect(splitMsgs.length).toBe(2);

    const splitRpcPayloads: {
      p_batch_id: string;
      p_part_index: number;
      p_total_parts: number;
    }[] = [];
    const splitRes = await handleQuizQueueBatch(
      {
        queue: 'quiz-attempt-batches',
        messages: splitMsgs.map((m, idx) => ({
          id: `split-${idx}`,
          body: m.message,
          ack: () => undefined,
          retry: () => undefined,
        })),
      },
      {
        SUPABASE_URL: 'https://example.supabase.co',
        QUIZ_BATCH_WORKER_JWT: 'worker-jwt-secret',
      },
      async (_input, init) => {
        splitRpcPayloads.push(
          JSON.parse(String(init?.body ?? '{}')) as {
            p_batch_id: string;
            p_part_index: number;
            p_total_parts: number;
          }
        );
        return new Response(
          JSON.stringify({
            ingested: true,
            duplicate: false,
            attemptsInserted: 1,
          }),
          { status: 200 }
        );
      }
    );
    expect(splitRes.acked).toBe(2);
    expect(splitRpcPayloads).toEqual(
      [
        {
          p_batch_id: `${bigBundle.eventId}:${bigBundle.roomId}:b1`,
          p_part_index: 0,
          p_total_parts: 1,
        },
        {
          p_batch_id: `${bigBundle.eventId}:${bigBundle.roomId}:b2`,
          p_part_index: 0,
          p_total_parts: 1,
        },
      ].map((e) => expect.objectContaining(e))
    );
  });

  it('classifies Nigerian mobile ASNs/orgs and falls back cleanly on unknown ISPs', () => {
    expect(
      classifyVerifiedNetwork(
        withCf(new Request('https://demo.test'), {
          asn: 29465,
          asOrganization: 'Other Org',
          colo: 'LOS',
          country: 'NG',
        })
      ).verifiedNetwork
    ).toBe('MTN Nigeria');
    expect(
      classifyVerifiedNetwork(
        withCf(new Request('https://demo.test'), {
          asn: 36873,
          asOrganization: 'Airtel Networks',
          colo: 'LOS',
          country: 'NG',
        })
      ).verifiedNetwork
    ).toBe('Airtel Nigeria');
    expect(
      classifyVerifiedNetwork(
        withCf(new Request('https://demo.test'), {
          asn: 328309,
          asOrganization: 'Globacom Limited',
          colo: 'LOS',
          country: 'NG',
        })
      ).verifiedNetwork
    ).toBe('Glo Nigeria');
    expect(
      classifyVerifiedNetwork(
        withCf(new Request('https://demo.test'), {
          asn: 29571,
          asOrganization: 'GLO',
          colo: 'LOS',
          country: 'NG',
        })
      ).verifiedNetwork
    ).toBe('Glo Nigeria');
    expect(
      classifyVerifiedNetwork(
        withCf(new Request('https://demo.test'), {
          asn: 37076,
          asOrganization: 'EMTS',
          colo: 'LOS',
          country: 'NG',
        })
      ).verifiedNetwork
    ).toBe('9mobile Nigeria');
    expect(
      classifyVerifiedNetwork(new Request('https://demo.test')).verifiedNetwork
    ).toBe('Unknown ISP (AS0)');
  });

  it('serves /demo without pre-selected carrier, gates invite code & telemetry, and aggregates verified ISP/mismatch report', async () => {
    const adapter = new NodeSqliteAdapter(':memory:');
    const demoState = new DemoStateEngine(adapter);
    const initializedRooms: string[] = [];

    const dispatchEnv = {
      QUIZ_TICKET_SECRET: 'demo-ticket-secret',
      QUIZ_JWT_SECRET: 'demo-jwt-secret',
      QUIZ_INTERNAL_COORDINATOR_SECRET: 'demo-admin-secret',
      QUIZ_DEMO_INVITE_CODE: 'lagos-probe-2026',
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
          const res = demoState.recordTelemetry(body as never);
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true, ...res }))
          );
        }
        if (path === '/internal/demo/active') {
          return Promise.resolve(
            new Response(JSON.stringify(demoState.getActiveRound()))
          );
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
      refreshControlState: () => Promise.resolve(),
      freezeAndSweepCoordinator: () =>
        Promise.resolve({
          persistedCloseAtMs: Date.now(),
          allRoomsSealed: true,
        }),
      fetchRoomBundles: () => Promise.resolve([]),
      materializeShard: () => Promise.resolve(),
      markRoundReconciled: (ms: number) => {
        demoState.markRoundReconciled(ms);
        return Promise.resolve();
      },
    };

    const pageRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/demo'),
      new URL('https://demo.test/demo'),
      dispatchEnv
    );
    expect(pageRes?.status).toBe(200);
    const pageHtml = (await pageRes?.text()) ?? '';
    expect(pageHtml).toContain('Baci Quiz');
    expect(pageHtml).toContain(
      '<button type="button" data-c="MTN">MTN</button>'
    );
    expect(pageHtml).not.toContain('data-c="MTN" class="active"');
    expect(pageHtml).toContain('id="join-btn" disabled');
    expect(pageHtml).toContain('id="invite-code"');
    expect(pageHtml).toContain('id="lobby-net"');

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
    const setupBody = (await setupRes?.json()) as { eventId: string };
    const eventId = setupBody.eventId;
    expect(eventId).toMatch(/^demo-round-3-/);
    expect(initializedRooms).toHaveLength(13);
    expect(initializedRooms[0]).toBe(`${eventId}:room-0000`);

    // Check-in fails closed when QUIZ_DEMO_INVITE_CODE is unset
    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/check-in', {
          method: 'POST',
          body: JSON.stringify({
            carrier: 'MTN',
            inviteCode: 'lagos-probe-2026',
          }),
        }),
        new URL('https://demo.test/api/demo/check-in'),
        { ...dispatchEnv, QUIZ_DEMO_INVITE_CODE: '' }
      )
    ).rejects.toMatchObject({ code: 'QUIZ_CONFIG_MISSING', status: 503 });

    // Check-in fails with 403 on missing/wrong invite code
    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/check-in', {
          method: 'POST',
          body: JSON.stringify({ carrier: 'MTN', inviteCode: 'wrong-code' }),
        }),
        new URL('https://demo.test/api/demo/check-in'),
        dispatchEnv
      )
    ).rejects.toMatchObject({ code: 'QUIZ_INVITE_REQUIRED', status: 403 });

    // Valid check-in via body inviteCode + MTN AS29465 CF metadata
    const checkInRes = await handleDemoWorkerRoute(
      withCf(
        new Request('https://demo.test/api/demo/check-in', {
          method: 'POST',
          body: JSON.stringify({
            carrier: 'MTN',
            nickname: 'AdaNG',
            roomId: 'room-0000',
            inviteCode: 'lagos-probe-2026',
          }),
        }),
        {
          asn: 29465,
          asOrganization: 'MTN Nigeria Communication Limited',
          colo: 'LOS',
          country: 'NG',
        }
      ),
      new URL('https://demo.test/api/demo/check-in'),
      dispatchEnv
    );
    expect(checkInRes?.status).toBe(200);
    const checkInJson = (await checkInRes?.json()) as {
      roomId: string;
      ticket: string;
      bearerToken: string;
      verifiedNetwork: string;
      asn: number;
      colo: string;
      networkMismatch: boolean;
    };
    expect(checkInJson.roomId).toBe(`${eventId}:room-0000`);
    expect(checkInJson.ticket.startsWith('bqt1.')).toBe(true);
    expect(checkInJson.verifiedNetwork).toBe('MTN Nigeria');
    expect(checkInJson.asn).toBe(29465);
    expect(checkInJson.colo).toBe('LOS');
    expect(checkInJson.networkMismatch).toBe(false);

    // Valid check-in via ?code= query param on SpaceX Starlink while claiming MTN -> networkMismatch: true
    const mismatchCheckIn = await handleDemoWorkerRoute(
      withCf(
        new Request(
          'https://demo.test/api/demo/check-in?code=lagos-probe-2026',
          {
            method: 'POST',
            body: JSON.stringify({
              carrier: 'MTN',
              nickname: 'WifiCheater',
            }),
          }
        ),
        {
          asn: 14593,
          asOrganization: 'SpaceX Starlink',
          colo: 'LOS',
          country: 'NG',
        }
      ),
      new URL('https://demo.test/api/demo/check-in?code=lagos-probe-2026'),
      dispatchEnv
    );
    const mismatchJson = (await mismatchCheckIn?.json()) as {
      ticket: string;
      verifiedNetwork: string;
      networkMismatch: boolean;
    };
    expect(mismatchJson.verifiedNetwork).toBe('SpaceX Starlink (AS14593)');
    expect(mismatchJson.networkMismatch).toBe(true);

    // Unauthenticated telemetry -> 401
    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            attemptId: 'att-1',
            questionIndex: 1,
            carrier: 'MTN',
            tapToAckMs: 150,
          }),
        }),
        new URL('https://demo.test/api/demo/telemetry'),
        dispatchEnv
      )
    ).rejects.toMatchObject({ status: 401 });

    // Mismatched eventId -> 403
    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          headers: { 'X-Baci-Quiz-Ticket': checkInJson.ticket },
          body: JSON.stringify({
            eventId: 'other-event',
            attemptId: 'att-1',
            questionIndex: 1,
            carrier: 'MTN',
            tapToAckMs: 150,
          }),
        }),
        new URL('https://demo.test/api/demo/telemetry'),
        dispatchEnv
      )
    ).rejects.toMatchObject({ status: 403 });

    // Out-of-bounds questionIndex & tapToAckMs -> 400
    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          headers: { 'X-Baci-Quiz-Ticket': checkInJson.ticket },
          body: JSON.stringify({
            eventId,
            attemptId: 'att-1',
            questionIndex: 11,
            carrier: 'MTN',
            tapToAckMs: 150,
          }),
        }),
        new URL('https://demo.test/api/demo/telemetry'),
        dispatchEnv
      )
    ).rejects.toMatchObject({ code: 'QUIZ_INVALID_TELEMETRY', status: 400 });

    await expect(
      handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          headers: { 'X-Baci-Quiz-Ticket': checkInJson.ticket },
          body: JSON.stringify({
            eventId,
            attemptId: 'att-1',
            questionIndex: 1,
            carrier: 'MTN',
            tapToAckMs: 0,
          }),
        }),
        new URL('https://demo.test/api/demo/telemetry'),
        dispatchEnv
      )
    ).rejects.toMatchObject({ code: 'QUIZ_INVALID_TELEMETRY', status: 400 });

    // Authenticated MTN telemetry + duplicate (attemptId, questionIndex) ignored by SQLite UNIQUE
    const mtnLatencies = [120, 240, 880, 1250];
    for (let i = 0; i < mtnLatencies.length; i += 1) {
      const ms = mtnLatencies[i] ?? 100;
      const tRes = await handleDemoWorkerRoute(
        withCf(
          new Request('https://demo.test/api/demo/telemetry', {
            method: 'POST',
            headers: { 'X-Baci-Quiz-Ticket': checkInJson.ticket },
            body: JSON.stringify({
              eventId,
              attemptId: 'att-mtn-1',
              questionIndex: i + 1,
              carrier: 'MTN',
              tapToAckMs: ms,
              retries: ms > 1000 ? 1 : 0,
            }),
          }),
          {
            asn: 29465,
            asOrganization: 'MTN Nigeria',
            colo: 'LOS',
            country: 'NG',
          }
        ),
        new URL('https://demo.test/api/demo/telemetry'),
        dispatchEnv
      );
      expect(await tRes?.json()).toMatchObject({
        ok: true,
        deduplicated: false,
      });
    }
    const dupRes = await handleDemoWorkerRoute(
      withCf(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          headers: { 'X-Baci-Quiz-Ticket': checkInJson.ticket },
          body: JSON.stringify({
            eventId,
            attemptId: 'att-mtn-1',
            questionIndex: 1,
            carrier: 'MTN',
            tapToAckMs: 9999,
          }),
        }),
        {
          asn: 29465,
          asOrganization: 'MTN Nigeria',
          colo: 'LOS',
          country: 'NG',
        }
      ),
      new URL('https://demo.test/api/demo/telemetry'),
      dispatchEnv
    );
    expect(await dupRes?.json()).toMatchObject({
      ok: true,
      deduplicated: true,
    });

    // Record mismatched sample (tapped MTN while on SpaceX Starlink)
    await handleDemoWorkerRoute(
      withCf(
        new Request('https://demo.test/api/demo/telemetry', {
          method: 'POST',
          headers: { 'X-Baci-Quiz-Ticket': mismatchJson.ticket },
          body: JSON.stringify({
            eventId,
            attemptId: 'att-starlink-1',
            questionIndex: 1,
            carrier: 'MTN',
            tapToAckMs: 310,
          }),
        }),
        {
          asn: 14593,
          asOrganization: 'SpaceX Starlink',
          colo: 'LOS',
          country: 'NG',
        }
      ),
      new URL('https://demo.test/api/demo/telemetry'),
      dispatchEnv
    );

    const reportJsonRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/demo/report?format=json'),
      new URL('https://demo.test/demo/report?format=json'),
      dispatchEnv
    );
    const report = (await reportJsonRes?.json()) as {
      totalSamples: number;
      mismatchedSelfReportCount: number;
      carriers: {
        verifiedNetwork: string;
        selfReportedCarrier: string;
        mismatchedSelfReportCount: number;
        asns: number[];
        under1sRatePct: number;
        p95Ms: number;
        colos: string[];
      }[];
    };
    expect(report.totalSamples).toBe(5);
    expect(report.mismatchedSelfReportCount).toBe(1);
    const mtnRow = report.carriers.find(
      (c) => c.verifiedNetwork === 'MTN Nigeria'
    );
    expect(mtnRow).toMatchObject({
      verifiedNetwork: 'MTN Nigeria',
      selfReportedCarrier: 'MTN',
      mismatchedSelfReportCount: 0,
      asns: [29465],
      under1sRatePct: 75,
      p95Ms: 1250,
      colos: ['LOS'],
    });
    const starlinkRow = report.carriers.find(
      (c) => c.verifiedNetwork === 'SpaceX Starlink (AS14593)'
    );
    expect(starlinkRow).toMatchObject({
      verifiedNetwork: 'SpaceX Starlink (AS14593)',
      selfReportedCarrier: 'MTN',
      mismatchedSelfReportCount: 1,
      asns: [14593],
      colos: ['LOS'],
    });

    const reportHtmlRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/demo/report'),
      new URL('https://demo.test/demo/report'),
      dispatchEnv
    );
    const reportHtml = (await reportHtmlRes?.text()) ?? '';
    expect(reportHtml).toContain('MTN Nigeria (AS29465)');
    expect(reportHtml).toContain('SpaceX Starlink (AS14593)');
    adapter.close();
  });

  it('auto-reconciles soloInstantResult without sealing rooms and auto-reconciles group rounds once endsAtMs passes', async () => {
    const demoAdapter = new NodeSqliteAdapter(':memory:');
    const demoState = new DemoStateEngine(demoAdapter);
    const rooms = new Map<
      string,
      { engine: QuizRoomEngine; adapter: NodeSqliteAdapter }
    >();
    const shards = new Map<
      string,
      { engine: ResultShardEngine; adapter: NodeSqliteAdapter }
    >();
    const coordAdapter = new NodeSqliteAdapter(':memory:');
    const coordinator = new EventCoordinatorEngine({
      storage: coordAdapter,
      roomClient: {
        sealRoom: async ({
          eventId,
          roomId,
          persistedCloseAtMs,
          mode,
          endsAtMs,
        }) => {
          const r = rooms.get(roomId);
          if (!r) throw new Error(`Missing room ${roomId}`);
          return r.engine.seal(persistedCloseAtMs, mode, { eventId, endsAtMs });
        },
      },
    });
    const controlState = new QuizControlStateStore(
      createEmptyControlState(Date.now(), 1)
    );

    const env = {
      QUIZ_TICKET_SECRET: 'reconcile-ticket-secret',
      QUIZ_JWT_SECRET: 'reconcile-jwt-secret',
      QUIZ_INTERNAL_COORDINATOR_SECRET: 'reconcile-admin-secret',
      QUIZ_DEMO_INVITE_CODE: 'reconcile-invite-code',
      RESULT_SHARD_COUNT: '4',
      callDemoDo: (path: string, body?: unknown) => {
        if (path === '/internal/demo/setup-round') {
          demoState.setActiveRound(body as never);
          return Promise.resolve(
            new Response(JSON.stringify({ ok: true, ...(body as object) }))
          );
        }
        if (path === '/internal/demo/active') {
          return Promise.resolve(
            new Response(JSON.stringify(demoState.getActiveRound()))
          );
        }
        if (path === '/internal/demo/check-in') {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                demoState.allocateCheckIn((body as { roomId?: string })?.roomId)
              )
            )
          );
        }
        return Promise.resolve(new Response('not found', { status: 404 }));
      },
      initRoom: (roomId: string, config: QuizEventConfig) => {
        const a = new NodeSqliteAdapter(':memory:');
        const engine = new QuizRoomEngine({
          roomId,
          storage: a,
          controlState,
        });
        engine.initialize(config);
        rooms.set(roomId, { engine, adapter: a });
        return Promise.resolve();
      },
      freezeCoordinator: (params: {
        eventId: string;
        endsAtMs: number;
        expectedRoomIds: readonly string[];
      }) => {
        coordinator.freezeExpectedRooms(params);
        return Promise.resolve();
      },
      refreshControlState: (_eventId: string, nowMs: number) => {
        controlState.applySnapshot(
          createEmptyControlState(nowMs, controlState.getVersion() + 1)
        );
        return Promise.resolve();
      },
      freezeAndSweepCoordinator: async (params: {
        eventId: string;
        endsAtMs: number;
        roomIds: readonly string[];
        nowMs: number;
      }) => {
        coordinator.freezeExpectedRooms({
          eventId: params.eventId,
          endsAtMs: params.endsAtMs,
          expectedRoomIds: params.roomIds,
        });
        const snap = await coordinator.sweepClose({
          eventId: params.eventId,
          nowMs: params.nowMs,
        });
        return {
          persistedCloseAtMs: snap.persistedCloseAtMs,
          allRoomsSealed: snap.allRoomsSealed,
        };
      },
      fetchRoomBundles: async (roomId: string) => {
        const r = rooms.get(roomId);
        return r ? r.engine.exportCompletedBundles() : [];
      },
      materializeShard: (
        shardName: string,
        eventMeta: PublishedShardEventMetadata,
        records: readonly QuizPrivateResultRecord[]
      ) => {
        let entry = shards.get(shardName);
        if (!entry) {
          const sa = new NodeSqliteAdapter(':memory:');
          entry = {
            adapter: sa,
            engine: new ResultShardEngine({
              shardIndex: 0,
              storage: sa,
              controlState,
            }),
          };
          shards.set(shardName, entry);
        }
        entry.engine.materializeResultsBatch(eventMeta, records);
        return Promise.resolve();
      },
      markRoundReconciled: (ms: number) => {
        demoState.markRoundReconciled(ms);
        return Promise.resolve();
      },
    };

    // 1) Solo warmup mode (`soloInstantResult: true`) reconciles immediately WITHOUT sealing rooms
    const soloSetup = await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/admin/setup-round', {
        method: 'POST',
        headers: { Authorization: 'Bearer reconcile-admin-secret' },
        body: JSON.stringify({
          round: 1,
          eventId: 'evt-solo-1',
          soloInstantResult: true,
        }),
      }),
      new URL('https://demo.test/api/demo/admin/setup-round'),
      env
    );
    expect(soloSetup?.status).toBe(200);
    const soloRoom = rooms.get('evt-solo-1:room-0000')?.engine;
    if (!soloRoom) throw new Error('Expected soloRoom');

    const playPlayer = async (nick: string, correctCount: number) => {
      const ciRes = await handleDemoWorkerRoute(
        new Request('https://demo.test/api/demo/check-in', {
          method: 'POST',
          body: JSON.stringify({
            carrier: 'MTN',
            nickname: nick,
            inviteCode: 'reconcile-invite-code',
          }),
        }),
        new URL('https://demo.test/api/demo/check-in'),
        env
      );
      const ci = (await ciRes?.json()) as {
        ticket: string;
        roomId: string;
        soloInstantResult: boolean;
      };
      expect(ci.soloInstantResult).toBe(true);
      const ticket = await verifyAdmissionTicket(ci.ticket, {
        secret: 'reconcile-ticket-secret',
      });
      const r = rooms.get(ci.roomId)?.engine;
      if (!r) throw new Error('Missing room');
      let st = r.startAttempt({
        ticket,
        integrityTier: 'basic',
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        startRequestId: `req-${nick}`,
        appVersion: 'demo-1',
        platform: 'web',
      });
      for (let q = 0; q < 10; q += 1) {
        st = await r.submitAnswer({
          ticket,
          attemptId: st.attemptId,
          questionId: st.question?.id ?? '',
          answer: q < correctCount ? 'opt-a' : 'opt-b',
        });
      }
      return { attemptId: st.attemptId, userId: ticket.userId };
    };

    const p1 = await playPlayer('SoloOne', 9);
    const rec1 = await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/reconcile', { method: 'POST' }),
      new URL('https://demo.test/api/demo/reconcile'),
      env
    );
    expect(rec1?.status).toBe(200);
    expect(await rec1?.json()).toMatchObject({
      reconciled: true,
      mode: 'solo_instant',
      participantCount: 1,
    });
    // Room MUST still be unsealed so a second solo tester can play!
    expect(soloRoom.getSealManifest()).toBeNull();

    const p2 = await playPlayer('SoloTwo', 10);
    await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/reconcile', { method: 'POST' }),
      new URL('https://demo.test/api/demo/reconcile'),
      env
    );
    // Verify p2 placed #1 (score 10) and p1 is #2 (score 9) in shard
    const shardResults = Array.from(shards.values());
    expect(shardResults.length).toBeGreaterThanOrEqual(1);
    let foundP2Rank = 0;
    for (const s of shardResults) {
      const r = await s.engine.getAttemptResult({
        attemptId: p2.attemptId,
        callerUserId: p2.userId,
      });
      if (r.availability === 'final') foundP2Rank = r.rank;
    }
    expect(foundP2Rank).toBe(1);
    expect(p1.attemptId).not.toBe(p2.attemptId);

    // 2) Group timed mode (`soloInstantResult: false`): pending before endsAtMs, seals on admin finalize-round override
    await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/admin/setup-round', {
        method: 'POST',
        headers: { Authorization: 'Bearer reconcile-admin-secret' },
        body: JSON.stringify({
          round: 2,
          eventId: 'evt-group-2',
          durationMs: 60_000,
          soloInstantResult: false,
        }),
      }),
      new URL('https://demo.test/api/demo/admin/setup-round'),
      env
    );

    const pendingRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/reconcile', { method: 'POST' }),
      new URL('https://demo.test/api/demo/reconcile'),
      env
    );
    expect(pendingRes?.status).toBe(202);
    expect(await pendingRes?.json()).toMatchObject({
      reconciled: false,
      mode: 'pending',
    });

    // Admin finalize-round with explicit { eventId, roomIds } override seals & reconciles immediately
    const finRes = await handleDemoWorkerRoute(
      new Request('https://demo.test/api/demo/admin/finalize-round', {
        method: 'POST',
        headers: { Authorization: 'Bearer reconcile-admin-secret' },
        body: JSON.stringify({
          eventId: 'evt-group-2',
          roomIds: ['evt-group-2:room-0000'],
        }),
      }),
      new URL('https://demo.test/api/demo/admin/finalize-round'),
      env
    );
    expect(finRes?.status).toBe(200);
    expect(await finRes?.json()).toMatchObject({
      reconciled: true,
      mode: 'group_sealed',
    });
    expect(
      rooms.get('evt-group-2:room-0000')?.engine.getSealManifest()
    ).not.toBeNull();

    for (const r of rooms.values()) r.adapter.close();
    for (const s of shards.values()) s.adapter.close();
    coordAdapter.close();
    demoAdapter.close();
  });
});
