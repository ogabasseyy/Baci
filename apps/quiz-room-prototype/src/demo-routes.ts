import type { QuizEventConfig } from './contracts';
import { buildDemoEventConfig } from './demo-config';
import { type DemoFinalizerEnv, reconcileDemoRound } from './demo-finalizer';
import {
  handleDemoCheckIn,
  handleDemoTelemetry,
  parseJsonObject,
} from './demo-player-routes';
import type { DemoRoundState } from './demo-state';
import {
  type DemoReportPayload,
  renderDemoPageHtml,
  renderDemoReportHtml,
} from './demo-ui';
import { verifyInternalCoordinatorAuth } from './ticket';

export { buildDemoEventConfig };

export interface DemoDispatchEnv extends DemoFinalizerEnv {
  QUIZ_TICKET_SECRET?: string;
  QUIZ_JWT_SECRET?: string;
  QUIZ_INTERNAL_COORDINATOR_SECRET?: string;
  QUIZ_DEMO_INVITE_CODE?: string;
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
    const body = (await parseJsonObject(request)) as {
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
    const eventId = body.eventId ?? `demo-round-${round}-${nowMs.toString(36)}`;
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
    return handleDemoCheckIn(request, url, env);
  }

  if (request.method === 'POST' && path === '/api/demo/telemetry') {
    return handleDemoTelemetry(request, env);
  }

  return null;
}
