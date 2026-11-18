/// <reference path="../.wrangler-types/worker-configuration.d.ts" />
import { DurableObject } from 'cloudflare:workers';
import type {
  QuizAdmissionTicket,
  QuizEventConfig,
  QuizIntegrityTier,
  QuizLiveRankSubmission,
  QuizPlatform,
  QuizPrivateResultRecord,
  QuizRoomSealMode,
} from './contracts';
import { QuizRoomError } from './contracts';
import { QuizControlStateStore } from './control-state';
import { EventCoordinatorEngine } from './coordinator';
import { LiveRankIndexEngine } from './live-rank';
import {
  computeResultShardIndex,
  type PublishedShardEventMetadata,
  ResultShardEngine,
} from './result-shard';
import { QuizRoomEngine } from './room-do';
import {
  type CloudflareDoStorageLike,
  CloudflareSqlStorageAdapter,
} from './sqlite-adapter';
import { verifyAdmissionTicket, verifyBearerJwt } from './ticket';

export type * from './batch-packer';
export type * from './contracts';
export type * from './control-state';
export type * from './coordinator';
export type * from './live-rank';
export type * from './result-shard';
export type * from './room-do';
export type * from './sqlite-adapter';
export type * from './ticket';

interface WorkerEnv {
  QUIZ_ROOM: DurableObjectNamespace<QuizRoomDO>;
  LIVE_RANK_INDEX: DurableObjectNamespace<LiveRankIndexDO>;
  RESULT_SHARD: DurableObjectNamespace<ResultShardDO>;
  EVENT_COORDINATOR: DurableObjectNamespace<EventCoordinatorDO>;
  QUIZ_TICKET_SECRET?: string;
  QUIZ_JWT_SECRET?: string;
  RESULT_SHARD_COUNT?: string;
  ORIGIN_BASE_URL?: string;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit
): Response {
  const mergedHeaders = new Headers(headers);
  if (!mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(body), { status, headers: mergedHeaders });
}

function errorResponse(error: unknown): Response {
  if (error instanceof QuizRoomError) {
    return jsonResponse(
      { error: error.message, code: error.code },
      error.status
    );
  }
  const message =
    error instanceof Error ? error.message : 'Unexpected quiz worker error';
  return jsonResponse({ error: message, code: 'QUIZ_INTERNAL_ERROR' }, 500);
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new QuizRoomError('QUIZ_INVALID_JSON', 'Malformed JSON body', 400);
  }
}

export class QuizRoomDO extends DurableObject<WorkerEnv> {
  private readonly engine: QuizRoomEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.engine = new QuizRoomEngine({
      roomId: ctx.id.toString(),
      storage: adapter,
    });
  }

  async alarm(): Promise<void> {
    await this.engine.onAlarm(Date.now());
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/internal/init') {
        const config = await readJsonBody<QuizEventConfig>(request);
        this.engine.initialize(config);
        return jsonResponse({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/internal/start') {
        const body = await readJsonBody<{
          ticket: QuizAdmissionTicket;
          integrityTier: QuizIntegrityTier;
          acceptedRulesVersion: string;
          termsAccepted: boolean;
          startRequestId: string;
          appVersion: string;
          platform: QuizPlatform;
        }>(request);
        return jsonResponse(this.engine.startAttempt(body));
      }
      if (request.method === 'POST' && url.pathname === '/internal/answer') {
        const body = await readJsonBody<{
          ticket: QuizAdmissionTicket;
          attemptId: string;
          questionId: string;
          answer: string;
        }>(request);
        return jsonResponse(
          await this.engine.submitAnswer({
            ...body,
            receivedAtMs: Date.now(),
          })
        );
      }
      if (request.method === 'POST' && url.pathname === '/internal/resume') {
        const body = await readJsonBody<{ ticket: QuizAdmissionTicket }>(
          request
        );
        return jsonResponse(this.engine.resumeAttempt(body.ticket, Date.now()));
      }
      if (request.method === 'POST' && url.pathname === '/internal/seal') {
        const body = await readJsonBody<{
          persistedCloseAtMs: number;
          mode: QuizRoomSealMode;
          eventId: string;
          endsAtMs: number;
        }>(request);
        return jsonResponse(
          await this.engine.seal(body.persistedCloseAtMs, body.mode, {
            eventId: body.eventId,
            endsAtMs: body.endsAtMs,
          })
        );
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export class LiveRankIndexDO extends DurableObject<WorkerEnv> {
  private readonly engine: LiveRankIndexEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.engine = new LiveRankIndexEngine({ storage: adapter });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/internal/submit') {
        const body = await readJsonBody<QuizLiveRankSubmission>(request);
        return jsonResponse(this.engine.recordSubmission(body));
      }
      if (request.method === 'POST' && url.pathname === '/internal/publish') {
        const body = await readJsonBody<{ eventId: string }>(request);
        return jsonResponse(
          this.engine.publishSnapshot(body.eventId, Date.now())
        );
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/leaderboard'
      ) {
        const body = await readJsonBody<{
          eventId: string;
          merchantId: string;
          callerCustomerId: string;
          callerUserId: string;
          isTestEvent?: boolean;
        }>(request);
        return jsonResponse(await this.engine.getLiveLeaderboard(body));
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export class ResultShardDO extends DurableObject<WorkerEnv> {
  private readonly engine: ResultShardEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.engine = new ResultShardEngine({
      shardIndex: 0,
      storage: adapter,
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/materialize'
      ) {
        const body = await readJsonBody<{
          eventMeta: PublishedShardEventMetadata;
          records: readonly QuizPrivateResultRecord[];
        }>(request);
        this.engine.materializeResultsBatch(body.eventMeta, body.records);
        return jsonResponse({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/internal/result') {
        const body = await readJsonBody<{
          attemptId: string;
          callerUserId: string;
          authorizationHeader?: string;
        }>(request);
        return jsonResponse(
          await this.engine.getAttemptResult({
            ...body,
            nowMs: Date.now(),
          })
        );
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/leaderboard'
      ) {
        const body = await readJsonBody<{
          eventId: string;
          callerUserId: string;
          callerCustomerId?: string;
          callerMerchantId?: string;
        }>(request);
        return jsonResponse(await this.engine.getPublishedLeaderboard(body));
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export class EventCoordinatorDO extends DurableObject<WorkerEnv> {
  private readonly engine: EventCoordinatorEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.engine = new EventCoordinatorEngine({
      storage: adapter,
      roomClient: {
        sealRoom: async ({
          eventId,
          roomId,
          persistedCloseAtMs,
          mode,
          endsAtMs,
        }) => {
          const stub = env.QUIZ_ROOM.get(env.QUIZ_ROOM.idFromName(roomId));
          const res = await stub.fetch('https://room.internal/internal/seal', {
            method: 'POST',
            body: JSON.stringify({
              eventId,
              persistedCloseAtMs,
              mode,
              endsAtMs,
            }),
          });
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_ROOM_SEAL_FAILED',
              `Room ${roomId} returned ${res.status}`,
              res.status
            );
          }
          return (await res.json()) as ReturnType<
            QuizRoomEngine['seal']
          > extends Promise<infer R>
            ? R
            : never;
        },
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/internal/freeze') {
        const body = await readJsonBody<{
          eventId: string;
          endsAtMs: number;
          expectedRoomIds: readonly string[];
        }>(request);
        this.engine.freezeExpectedRooms(body);
        return jsonResponse({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/internal/sweep') {
        const body = await readJsonBody<{
          eventId: string;
          mode?: QuizRoomSealMode;
          maxRoomsPerSweep?: number;
        }>(request);
        return jsonResponse(
          await this.engine.sweepClose({
            ...body,
            nowMs: Date.now(),
          })
        );
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

function getTicketSecret(env: WorkerEnv): string {
  return env.QUIZ_TICKET_SECRET ?? 'dev-quiz-ticket-secret-placeholder';
}

function getJwtSecret(env: WorkerEnv): string {
  return env.QUIZ_JWT_SECRET ?? 'dev-quiz-jwt-secret-placeholder';
}

function getShardCount(env: WorkerEnv): number {
  const parsed = Number.parseInt(env.RESULT_SHARD_COUNT ?? '16', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 16;
}

const defaultControlState = new QuizControlStateStore();

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      const startMatch = /^\/api\/quiz\/events\/([^/]+)\/start$/.exec(path);
      if (request.method === 'POST' && startMatch?.[1]) {
        const eventId = startMatch[1];
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
        const ticket = await verifyAdmissionTicket(ticketHeader, {
          secret: getTicketSecret(env),
          expectedEventId: eventId,
          nowMs: Date.now(),
        });
        const body = await readJsonBody<{
          integrityTier: QuizIntegrityTier;
          acceptedRulesVersion: string;
          termsAccepted: boolean;
          startRequestId: string;
          appVersion: string;
          platform: QuizPlatform;
        }>(request);
        const roomStub = env.QUIZ_ROOM.get(
          env.QUIZ_ROOM.idFromName(ticket.roomId)
        );
        return roomStub.fetch('https://room.internal/internal/start', {
          method: 'POST',
          body: JSON.stringify({ ...body, ticket }),
        });
      }

      const answerMatch = /^\/api\/quiz\/attempts\/([^/]+)\/answers$/.exec(
        path
      );
      if (request.method === 'POST' && answerMatch?.[1]) {
        const attemptId = answerMatch[1];
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
        const ticket = await verifyAdmissionTicket(ticketHeader, {
          secret: getTicketSecret(env),
          nowMs: Date.now(),
        });
        const body = await readJsonBody<{
          questionId: string;
          answer: string;
        }>(request);
        const roomStub = env.QUIZ_ROOM.get(
          env.QUIZ_ROOM.idFromName(ticket.roomId)
        );
        return roomStub.fetch('https://room.internal/internal/answer', {
          method: 'POST',
          body: JSON.stringify({
            ticket,
            attemptId,
            questionId: body.questionId,
            answer: body.answer,
          }),
        });
      }

      const activeMatch = /^\/api\/quiz\/attempts\/([^/]+)\/active$/.exec(path);
      if (request.method === 'GET' && activeMatch?.[1]) {
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
        const ticket = await verifyAdmissionTicket(ticketHeader, {
          secret: getTicketSecret(env),
          nowMs: Date.now(),
        });
        const roomStub = env.QUIZ_ROOM.get(
          env.QUIZ_ROOM.idFromName(ticket.roomId)
        );
        return roomStub.fetch('https://room.internal/internal/resume', {
          method: 'POST',
          body: JSON.stringify({ ticket }),
        });
      }

      const resultMatch = /^\/api\/quiz\/attempts\/([^/]+)\/result$/.exec(path);
      if (request.method === 'GET' && resultMatch?.[1]) {
        const attemptId = resultMatch[1];
        const user = await verifyBearerJwt(
          request.headers.get('Authorization'),
          { secret: getJwtSecret(env), nowMs: Date.now() }
        );
        const eventId = url.searchParams.get('eventId') ?? 'default-event';
        const shardIdx = await computeResultShardIndex(
          eventId,
          user.userId,
          getShardCount(env)
        );
        const shardStub = env.RESULT_SHARD.get(
          env.RESULT_SHARD.idFromName(`${eventId}:shard:${shardIdx}`)
        );
        return shardStub.fetch('https://shard.internal/internal/result', {
          method: 'POST',
          body: JSON.stringify({
            attemptId,
            callerUserId: user.userId,
            authorizationHeader:
              request.headers.get('Authorization') ?? undefined,
          }),
        });
      }

      if (request.method === 'GET' && path === '/api/quiz/leaderboard') {
        const eventId = url.searchParams.get('eventId');
        if (!eventId) {
          throw new QuizRoomError(
            'QUIZ_INVALID_INPUT',
            'eventId query parameter is required',
            400
          );
        }
        const user = await verifyBearerJwt(
          request.headers.get('Authorization'),
          { secret: getJwtSecret(env), nowMs: Date.now() }
        );
        const shardIdx = await computeResultShardIndex(
          eventId,
          user.userId,
          getShardCount(env)
        );
        const shardStub = env.RESULT_SHARD.get(
          env.RESULT_SHARD.idFromName(`${eventId}:shard:${shardIdx}`)
        );
        return shardStub.fetch('https://shard.internal/internal/leaderboard', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            callerUserId: user.userId,
          }),
        });
      }

      if (request.method === 'GET' && path === '/api/quiz/leaderboard/live') {
        const eventId = url.searchParams.get('eventId');
        const merchantId = url.searchParams.get('merchantId') ?? 'unknown';
        const customerId = url.searchParams.get('customerId') ?? '';
        if (!eventId) {
          throw new QuizRoomError(
            'QUIZ_INVALID_INPUT',
            'eventId query parameter is required',
            400
          );
        }
        const user = await verifyBearerJwt(
          request.headers.get('Authorization'),
          { secret: getJwtSecret(env), nowMs: Date.now() }
        );
        const rankStub = env.LIVE_RANK_INDEX.get(
          env.LIVE_RANK_INDEX.idFromName(eventId)
        );
        return rankStub.fetch('https://rank.internal/internal/leaderboard', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            merchantId,
            callerCustomerId: customerId || user.userId,
            callerUserId: user.userId,
          }),
        });
      }

      const statusMatch = /^\/api\/quiz\/events\/([^/]+)\/status$/.exec(path);
      if (request.method === 'GET' && statusMatch?.[1]) {
        const eventId = statusMatch[1];
        const pub = defaultControlState.getPublishedEvent(eventId);
        const cancelled = defaultControlState.isEventCancelled(eventId);
        return jsonResponse(
          {
            eventId,
            status: cancelled ? 'cancelled' : pub ? 'completed' : 'active',
            resultsPublishedAt: pub
              ? new Date(pub.publishedAtMs).toISOString()
              : null,
          },
          200,
          { 'Cache-Control': 'public, max-age=3' }
        );
      }

      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
