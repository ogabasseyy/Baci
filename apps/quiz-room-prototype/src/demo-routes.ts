import type {
  QuizAdmissionTicket,
  QuizEventConfig,
  QuizQuestionSlot,
} from './contracts';
import { quizAnswerKeyHash } from './crypto';
import { type DemoFinalizerEnv, reconcileDemoRound } from './demo-finalizer';
import type { DemoRoundState, DemoTelemetryInput } from './demo-state';
import {
  type DemoReportPayload,
  renderDemoPageHtml,
  renderDemoReportHtml,
} from './demo-ui';
import {
  requireConfiguredSecret,
  signAdmissionTicket,
  signBearerJwt,
  verifyInternalCoordinatorAuth,
} from './ticket';

export async function buildDemoEventConfig(params: {
  eventId: string;
  merchantId: string;
  startsAtMs: number;
  endsAtMs: number;
}): Promise<QuizEventConfig> {
  const answerHash = await quizAnswerKeyHash('opt-a');
  const slots: QuizQuestionSlot[] = Array.from({ length: 10 }, (_, idx) => {
    const qNum = idx + 1;
    const slotId = `00000000-0000-4000-8000-${String(qNum).padStart(12, '0')}`;
    return {
      id: slotId,
      slotIndex: qNum,
      active: true,
      variants: [1, 2, 3].map((v) => ({
        id: `10000000-0000-4000-8000-${String(qNum * 10 + v).padStart(12, '0')}`,
        slotId,
        prompt: `Round Question ${qNum} (Variant ${v}): Which option wins?`,
        options: [
          { id: 'opt-a', label: 'A — Verified Correct Answer' },
          { id: 'opt-b', label: 'B — Distractor Two' },
          { id: 'opt-c', label: 'C — Distractor Three' },
          { id: 'opt-d', label: 'D — Distractor Four' },
        ],
        answerKeyHash: answerHash,
        active: true,
      })),
    };
  });
  return {
    eventId: params.eventId,
    merchantId: params.merchantId,
    mode: 'live',
    contractVersion: 2,
    rulesVersion: 'live-v1',
    questionCount: 10,
    timePerQuestionSeconds: 10,
    maxAttempts: 1,
    startsAtMs: params.startsAtMs,
    endsAtMs: params.endsAtMs,
    status: 'active',
    slots,
  };
}

export interface DemoDispatchEnv extends DemoFinalizerEnv {
  QUIZ_TICKET_SECRET?: string;
  QUIZ_JWT_SECRET?: string;
  QUIZ_INTERNAL_COORDINATOR_SECRET?: string;
  callDemoDo(path: string, body?: unknown): Promise<Response>;
  initRoom(roomId: string, config: QuizEventConfig): Promise<void>;
  freezeCoordinator(params: {
    eventId: string;
    endsAtMs: number;
    expectedRoomIds: readonly string[];
  }): Promise<void>;
  refreshControlState(eventId: string, nowMs: number): Promise<void>;
}

function buildRoundRoomIds(
  eventId: string,
  round: 1 | 2 | 3,
  overrideCount?: number
): string[] {
  const defaultCount = round === 3 ? 13 : 1;
  const count = Math.max(1, Math.min(64, overrideCount ?? defaultCount));
  return Array.from(
    { length: count },
    (_, i) => `${eventId}:room-${String(i).padStart(4, '0')}`
  );
}

export async function handleDemoWorkerRoute(
  request: Request,
  url: URL,
  env: DemoDispatchEnv
): Promise<Response | null> {
  const path = url.pathname;

  if (request.method === 'GET' && path === '/demo') {
    return new Response(renderDemoPageHtml(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (request.method === 'GET' && path === '/demo/report') {
    const res = await env.callDemoDo('/internal/demo/report');
    const report = (await res.json()) as DemoReportPayload;
    if (url.searchParams.get('format') === 'json') {
      return new Response(JSON.stringify(report), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    return new Response(renderDemoReportHtml(report), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (request.method === 'POST' && path === '/api/demo/admin/setup-round') {
    verifyInternalCoordinatorAuth(
      request.headers.get('Authorization'),
      env.QUIZ_INTERNAL_COORDINATOR_SECRET
    );
    const body = (await request.json()) as {
      round?: 1 | 2 | 3;
      startsInMs?: number;
      durationMs?: number;
      roomCount?: number;
      eventId?: string;
      soloInstantResult?: boolean;
    };
    const round: 1 | 2 | 3 =
      body.round === 2 || body.round === 3 ? body.round : 1;
    const soloInstantResult = Boolean(body.soloInstantResult);
    const nowMs = Date.now();
    const startsAtMs = nowMs + (body.startsInMs ?? 0);
    const defaultDurationMs = soloInstantResult ? 43_200_000 : 120_000;
    const endsAtMs = startsAtMs + (body.durationMs ?? defaultDurationMs);
    const eventId =
      body.eventId ??
      `11111111-1111-4111-8111-${String(round).padStart(12, '0')}`;
    const merchantId = 'merch-ogabassey-demo';
    const roomIds = buildRoundRoomIds(eventId, round, body.roomCount);
    const config = await buildDemoEventConfig({
      eventId,
      merchantId,
      startsAtMs,
      endsAtMs,
    });
    await Promise.all(roomIds.map((roomId) => env.initRoom(roomId, config)));
    await env.freezeCoordinator({
      eventId,
      endsAtMs,
      expectedRoomIds: roomIds,
    });
    await env.refreshControlState(eventId, nowMs);
    const roundState: DemoRoundState = {
      round,
      eventId,
      merchantId,
      roomIds,
      startsAtMs,
      endsAtMs,
      nextAssignSeq: 0,
      soloInstantResult,
      reconciledAtMs: null,
    };
    return env.callDemoDo('/internal/demo/setup-round', roundState);
  }

  if (request.method === 'POST' && path === '/api/demo/admin/finalize-round') {
    verifyInternalCoordinatorAuth(
      request.headers.get('Authorization'),
      env.QUIZ_INTERNAL_COORDINATOR_SECRET
    );
    const rawBody = await request.text();
    const body = (rawBody.trim() ? JSON.parse(rawBody) : {}) as {
      eventId?: string;
      roomIds?: readonly string[];
      endsAtMs?: number;
    };
    const roundRes = await env.callDemoDo('/internal/demo/active');
    const round = roundRes.ok
      ? ((await roundRes.json()) as DemoRoundState | null)
      : null;
    const override =
      body.eventId && Array.isArray(body.roomIds) && body.roomIds.length > 0
        ? {
            eventId: body.eventId,
            roomIds: body.roomIds,
            endsAtMs: body.endsAtMs,
          }
        : undefined;
    const res = await reconcileDemoRound(
      { round, override, forceAdmin: true, nowMs: Date.now() },
      env
    );
    return new Response(JSON.stringify(res), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (request.method === 'POST' && path === '/api/demo/reconcile') {
    const roundRes = await env.callDemoDo('/internal/demo/active');
    const round = roundRes.ok
      ? ((await roundRes.json()) as DemoRoundState | null)
      : null;
    const res = await reconcileDemoRound({ round, nowMs: Date.now() }, env);
    return new Response(JSON.stringify(res), {
      status: res.reconciled ? 200 : 202,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (request.method === 'POST' && path === '/api/demo/check-in') {
    const ticketSecret = requireConfiguredSecret(
      env.QUIZ_TICKET_SECRET,
      'QUIZ_TICKET_SECRET'
    );
    const jwtSecret = requireConfiguredSecret(
      env.QUIZ_JWT_SECRET,
      'QUIZ_JWT_SECRET'
    );
    const body = (await request.json()) as {
      carrier?: string;
      nickname?: string;
      roomId?: string;
    };
    const allocRes = await env.callDemoDo('/internal/demo/check-in', {
      roomId: body.roomId,
    });
    if (!allocRes.ok) return allocRes;
    const alloc = (await allocRes.json()) as {
      round: DemoRoundState;
      roomId: string;
      playerSeq: number;
    };
    await env.refreshControlState(alloc.round.eventId, Date.now());
    const userId = `demo-u-${alloc.round.round}-${alloc.playerSeq}`;
    const customerId = `demo-c-${alloc.round.round}-${alloc.playerSeq}`;
    const deviceHash = String(alloc.playerSeq).padStart(64, '0');
    const nickname = (body.nickname ?? `Player-${alloc.playerSeq}`).trim();
    const ticket: QuizAdmissionTicket = {
      userId,
      customerId,
      merchantId: alloc.round.merchantId,
      eventId: alloc.round.eventId,
      roomId: alloc.roomId,
      deviceHash,
      leaderboardUsername: nickname,
      expiresAtMs: alloc.round.endsAtMs + 60_000,
      mode: 'live',
    };
    const [signedTicket, bearerToken] = await Promise.all([
      signAdmissionTicket(ticket, ticketSecret),
      signBearerJwt(
        {
          sub: userId,
          merchantId: alloc.round.merchantId,
          customerId,
          exp: Math.floor((alloc.round.endsAtMs + 3_600_000) / 1000),
        },
        jwtSecret
      ),
    ]);
    return new Response(
      JSON.stringify({
        round: alloc.round.round,
        eventId: alloc.round.eventId,
        roomId: alloc.roomId,
        startsAtMs: alloc.round.startsAtMs,
        endsAtMs: alloc.round.endsAtMs,
        soloInstantResult: Boolean(alloc.round.soloInstantResult),
        nickname,
        carrier: body.carrier ?? 'MTN',
        ticket: signedTicket,
        bearerToken,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  }

  if (request.method === 'POST' && path === '/api/demo/telemetry') {
    const body = (await request.json()) as Omit<DemoTelemetryInput, 'colo'>;
    const cf = (request as Request & { cf?: { colo?: string } }).cf;
    return env.callDemoDo('/internal/demo/telemetry', {
      ...body,
      colo: cf?.colo ?? 'LOCAL',
    });
  }

  return null;
}
