/// <reference path="../.wrangler-types/worker-configuration.d.ts" />
import { DurableObject } from 'cloudflare:workers';
import type {
  QuizAdmissionTicket,
  QuizAttemptBundle,
  QuizControlStateSnapshot,
  QuizEventConfig,
  QuizIntegrityTier,
  QuizLiveRankSubmission,
  QuizPackedQueueMessage,
  QuizPlatform,
  QuizPrivateResultRecord,
  QuizRoomSealMode,
} from './contracts';
import { QuizRoomError } from './contracts';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from './control-state';
import { EventCoordinatorEngine } from './coordinator';
import { handleDemoWorkerRoute } from './demo-routes';
import {
  type DemoRoundState,
  DemoStateEngine,
  type DemoTelemetryInput,
} from './demo-state';
import { LiveRankIndexEngine } from './live-rank';
import {
  handleQuizQueueBatch,
  type QuizQueueBatchLike,
} from './queue-consumer';
import {
  computeResultShardIndex,
  type OriginWinnerAwardPayload,
  type PublishedShardEventMetadata,
  ResultShardEngine,
} from './result-shard';
import { QuizRoomEngine } from './room-do';
import {
  type CloudflareDoStorageLike,
  CloudflareSqlStorageAdapter,
} from './sqlite-adapter';
import {
  requireConfiguredSecret,
  verifyAdmissionTicket,
  verifyBearerJwt,
  verifyInternalCoordinatorAuth,
} from './ticket';

export type * from './batch-packer';
export type * from './contracts';
export type * from './control-state';
export type * from './coordinator';
export type * from './demo-config';
export type * from './demo-finalizer';
export type * from './demo-isp';
export type * from './demo-player-routes';
export type * from './demo-routes';
export type * from './demo-state';
export type * from './demo-ui';
export type * from './live-rank';
export type * from './queue-consumer';
export type * from './result-shard';
export type * from './room-do';
export type * from './sqlite-adapter';
export type * from './ticket';

interface WorkerEnv {
  QUIZ_ROOM: DurableObjectNamespace<QuizRoomDO>;
  LIVE_RANK_INDEX: DurableObjectNamespace<LiveRankIndexDO>;
  RESULT_SHARD: DurableObjectNamespace<ResultShardDO>;
  EVENT_COORDINATOR: DurableObjectNamespace<EventCoordinatorDO>;
  DEMO_STATE: DurableObjectNamespace<DemoStateDO>;
  QUIZ_BATCH_QUEUE?: Queue<QuizPackedQueueMessage>;
  QUIZ_TICKET_SECRET?: string;
  QUIZ_JWT_SECRET?: string;
  QUIZ_INTERNAL_COORDINATOR_SECRET?: string;
  QUIZ_DEMO_INVITE_CODE?: string;
  QUIZ_BATCH_WORKER_JWT?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  RESULT_SHARD_COUNT?: string;
  ORIGIN_BASE_URL?: string;
}

const WEUR_LOCATION_HINT = { locationHint: 'weur' } as const;

function getWeurStub<
  T extends {
    idFromName(name: string): unknown;
    get(id: never, options?: { locationHint?: 'weur' }): unknown;
  },
>(ns: T, name: string): ReturnType<T['get']> {
  return ns.get(ns.idFromName(name) as never, WEUR_LOCATION_HINT) as ReturnType<
    T['get']
  >;
}

const DEMO_STATE_DO_NAME = 'demo-state-weur-v2';

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
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new QuizRoomError('QUIZ_INVALID_JSON', 'Malformed JSON body', 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QuizRoomError(
      'QUIZ_INVALID_INPUT',
      'Request body must be a JSON object',
      400
    );
  }
  return parsed as T;
}

export class QuizRoomDO extends DurableObject<WorkerEnv> {
  private readonly controlState: QuizControlStateStore;
  private readonly engine: QuizRoomEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.controlState = new QuizControlStateStore();
    this.engine = new QuizRoomEngine({
      roomId: ctx.id.name ?? ctx.id.toString(),
      storage: adapter,
      controlState: this.controlState,
      hooks: {
        onPublishBatches: async (messages) => {
          if (messages.length === 0) return;
          const uuidRe =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const sendable = messages.filter((m) =>
            uuidRe.test(m.message.eventId)
          );
          if (sendable.length === 0) return;
          if (
            !env.QUIZ_BATCH_QUEUE ||
            !env.SUPABASE_URL ||
            !env.QUIZ_BATCH_WORKER_JWT
          ) {
            throw new QuizRoomError(
              'QUIZ_QUEUE_NOT_CONFIGURED',
              'Production quiz batch queue delivery is not configured',
              503
            );
          }
          // Enforce Cloudflare Queue sendBatch limits: <= 100 messages AND <= 256 KB total.
          const MAX_BATCH_MESSAGES = 100;
          const MAX_BATCH_BYTES = 240_000;
          let chunk: { body: QuizPackedQueueMessage }[] = [];
          let chunkBytes = 0;
          for (const m of sendable) {
            const msgBytes = Math.max(1, m.byteLength);
            if (
              chunk.length > 0 &&
              (chunk.length >= MAX_BATCH_MESSAGES ||
                chunkBytes + msgBytes > MAX_BATCH_BYTES)
            ) {
              await env.QUIZ_BATCH_QUEUE.sendBatch(chunk);
              chunk = [];
              chunkBytes = 0;
            }
            chunk.push({ body: m.message });
            chunkBytes += msgBytes;
          }
          if (chunk.length > 0) {
            await env.QUIZ_BATCH_QUEUE.sendBatch(chunk);
          }
        },
        onScoreboardTick: async (tick) => {
          if (!env.LIVE_RANK_INDEX || tick.submissions.length === 0) return;
          const rankStub = getWeurStub(env.LIVE_RANK_INDEX, tick.eventId);
          const submissions: QuizLiveRankSubmission[] = tick.submissions.map(
            (s) => ({
              eventId: tick.eventId,
              merchantId: tick.merchantId,
              attemptId: s.attemptId,
              customerId: s.customerId,
              userId: s.userId,
              leaderboardUsername: s.leaderboardUsername,
              score: s.score,
              elapsedMs: s.elapsedMs,
              submittedAtMs: s.submittedAtMs,
              attemptStatus: 'submitted',
            })
          );
          const res = await rankStub.fetch(
            'https://rank.internal/internal/submit-batch',
            {
              method: 'POST',
              body: JSON.stringify({
                eventId: tick.eventId,
                submissions,
                publish: true,
              }),
            }
          );
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_LIVE_RANK_SYNC_FAILED',
              `Live rank batch sync failed (${res.status})`,
              res.status
            );
          }
        },
      },
    });
  }

  private async refreshControlStateIfStale(
    eventId: string,
    nowMs: number
  ): Promise<void> {
    if (this.controlState.isFresh(nowMs) || !this.env.EVENT_COORDINATOR) {
      return;
    }
    const coordStub = getWeurStub(this.env.EVENT_COORDINATOR, eventId);
    const csRes = await coordStub.fetch(
      `https://coord.internal/internal/control-state?eventId=${encodeURIComponent(eventId)}`
    );
    if (!csRes.ok) {
      if (!this.controlState.isFresh(Date.now())) {
        throw new QuizRoomError(
          'QUIZ_CONTROL_STATE_UNAVAILABLE',
          `Failed to refresh control state for event ${eventId} (${csRes.status})`,
          503
        );
      }
      return;
    }
    const snapshot = (await csRes.json()) as QuizControlStateSnapshot;
    this.controlState.applySnapshot(snapshot);
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
        if (this.env.EVENT_COORDINATOR) {
          await this.refreshControlStateIfStale(config.eventId, Date.now());
        }
        if (this.controlState.getVersion() === 0) {
          this.controlState.applySnapshot(
            createEmptyControlState(Date.now(), 1)
          );
        }
        return jsonResponse({ ok: true, roomId: this.engine.roomId });
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/control-state'
      ) {
        const snapshot = await readJsonBody<QuizControlStateSnapshot>(request);
        const applied = this.controlState.applySnapshot(snapshot);
        return jsonResponse({
          ok: true,
          applied,
          version: this.controlState.getVersion(),
        });
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
        await this.refreshControlStateIfStale(body.ticket.eventId, Date.now());
        return jsonResponse(
          this.engine.startAttempt({ ...body, nowMs: Date.now() })
        );
      }
      if (request.method === 'POST' && url.pathname === '/internal/answer') {
        const body = await readJsonBody<{
          ticket: QuizAdmissionTicket;
          attemptId: string;
          questionId: string;
          answer: string;
        }>(request);
        const nowMs = Date.now();
        await this.refreshControlStateIfStale(body.ticket.eventId, nowMs);
        return jsonResponse(
          await this.engine.submitAnswer({
            ...body,
            receivedAtMs: nowMs,
          })
        );
      }
      if (request.method === 'POST' && url.pathname === '/internal/resume') {
        const body = await readJsonBody<{ ticket: QuizAdmissionTicket }>(
          request
        );
        await this.refreshControlStateIfStale(body.ticket.eventId, Date.now());
        return jsonResponse(this.engine.resumeAttempt(body.ticket, Date.now()));
      }
      if (request.method === 'POST' && url.pathname === '/internal/seal') {
        const body = await readJsonBody<{
          persistedCloseAtMs: number;
          mode: QuizRoomSealMode;
          eventId: string;
          endsAtMs: number;
        }>(request);
        if (this.env.EVENT_COORDINATOR) {
          const coordStub = getWeurStub(
            this.env.EVENT_COORDINATOR,
            body.eventId
          );
          const csRes = await coordStub.fetch(
            `https://coord.internal/internal/control-state?eventId=${encodeURIComponent(body.eventId)}`
          );
          if (!csRes.ok) {
            throw new QuizRoomError(
              'QUIZ_CONTROL_STATE_UNAVAILABLE',
              `Failed to refresh control state for event ${body.eventId} (${csRes.status})`,
              503
            );
          }
          const snapshot = (await csRes.json()) as QuizControlStateSnapshot;
          this.controlState.applySnapshot(snapshot);
        }
        return jsonResponse(
          await this.engine.seal(body.persistedCloseAtMs, body.mode, {
            eventId: body.eventId,
            endsAtMs: body.endsAtMs,
          })
        );
      }
      if (
        url.pathname === '/internal/batches' ||
        url.pathname === '/internal/bundles'
      ) {
        const bundles = await this.engine.exportCompletedBundles();
        return jsonResponse({ bundles });
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export class LiveRankIndexDO extends DurableObject<WorkerEnv> {
  private readonly controlState: QuizControlStateStore;
  private readonly engine: LiveRankIndexEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.controlState = new QuizControlStateStore();
    this.engine = new LiveRankIndexEngine({
      storage: adapter,
      controlState: this.controlState,
    });
  }

  private async refreshControlState(eventId: string): Promise<void> {
    if (!this.env.EVENT_COORDINATOR) {
      return;
    }
    const coordStub = getWeurStub(this.env.EVENT_COORDINATOR, eventId);
    const csRes = await coordStub.fetch(
      `https://coord.internal/internal/control-state?eventId=${encodeURIComponent(eventId)}`
    );
    if (!csRes.ok) {
      if (!this.controlState.isFresh(Date.now())) {
        throw new QuizRoomError(
          'QUIZ_CONTROL_STATE_UNAVAILABLE',
          `Failed to refresh control state for event ${eventId} (${csRes.status})`,
          503
        );
      }
      return;
    }
    const snapshot = (await csRes.json()) as QuizControlStateSnapshot;
    this.controlState.applySnapshot(snapshot);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/control-state'
      ) {
        const snapshot = await readJsonBody<QuizControlStateSnapshot>(request);
        const applied = this.controlState.applySnapshot(snapshot);
        return jsonResponse({
          ok: true,
          applied,
          version: this.controlState.getVersion(),
        });
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/submit-batch'
      ) {
        const body = await readJsonBody<{
          eventId?: string;
          submissions: readonly QuizLiveRankSubmission[];
          publish?: boolean;
        }>(request);
        const publishNowMs = body.publish === false ? undefined : Date.now();
        return jsonResponse(
          this.engine.recordSubmissionsBatch(body.submissions, publishNowMs)
        );
      }
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
        await this.refreshControlState(body.eventId);
        return jsonResponse(await this.engine.getLiveLeaderboard(body));
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export class ResultShardDO extends DurableObject<WorkerEnv> {
  private readonly adapter: CloudflareSqlStorageAdapter;
  private readonly defaultControlState: QuizControlStateStore;
  private readonly defaultEngine: ResultShardEngine;
  private readonly eventShards = new Map<
    string,
    { controlState: QuizControlStateStore; engine: ResultShardEngine }
  >();

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.defaultControlState = new QuizControlStateStore();
    this.defaultEngine = this.createEngine(this.defaultControlState);
  }

  private createEngine(controlState: QuizControlStateStore): ResultShardEngine {
    const env = this.env;
    return new ResultShardEngine({
      shardIndex: 0,
      storage: this.adapter,
      controlState,
      hooks: {
        fetchWinnerAwardFromOrigin: async ({
          attemptId,
          authorizationHeader,
        }) => {
          if (!env.ORIGIN_BASE_URL || !authorizationHeader) {
            throw new QuizRoomError(
              'QUIZ_WINNER_ORIGIN_REQUIRED',
              'Winner award lookup requires ORIGIN_BASE_URL and Authorization',
              503
            );
          }
          const res = await fetch(
            `${env.ORIGIN_BASE_URL.replace(/\/$/, '')}/api/quiz/attempts/${encodeURIComponent(attemptId)}/result`,
            {
              method: 'GET',
              headers: {
                Authorization: authorizationHeader,
                'X-Baci-Quiz-Contract': '2',
              },
            }
          );
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_WINNER_ORIGIN_FAILED',
              `Origin winner award lookup returned ${res.status}`,
              res.status
            );
          }
          const payload = (await res.json()) as {
            availability?: string;
            claim?: OriginWinnerAwardPayload['claim'];
            prizeClaim?: OriginWinnerAwardPayload['prizeClaim'];
          };
          if (payload.availability && payload.availability !== 'final') {
            throw new QuizRoomError(
              'QUIZ_WINNER_ORIGIN_NOT_FINAL',
              `Origin winner award lookup returned ${payload.availability}`,
              503
            );
          }
          return {
            ...(payload.claim ? { claim: payload.claim } : {}),
            ...(payload.prizeClaim ? { prizeClaim: payload.prizeClaim } : {}),
          };
        },
      },
    });
  }

  private getEventShard(eventId: string): {
    controlState: QuizControlStateStore;
    engine: ResultShardEngine;
  } {
    let entry = this.eventShards.get(eventId);
    if (!entry) {
      const controlState = new QuizControlStateStore();
      entry = { controlState, engine: this.createEngine(controlState) };
      this.eventShards.set(eventId, entry);
    }
    return entry;
  }

  private async refreshControlStateIfStale(
    eventId: string,
    nowMs: number
  ): Promise<{
    controlState: QuizControlStateStore;
    engine: ResultShardEngine;
  }> {
    const shard = this.getEventShard(eventId);
    if (shard.controlState.isFresh(nowMs) || !this.env.EVENT_COORDINATOR) {
      return shard;
    }
    const coordStub = getWeurStub(this.env.EVENT_COORDINATOR, eventId);
    const csRes = await coordStub.fetch(
      `https://coord.internal/internal/control-state?eventId=${encodeURIComponent(eventId)}`
    );
    if (csRes.ok) {
      const snapshot = (await csRes.json()) as QuizControlStateSnapshot;
      shard.controlState.applySnapshot(snapshot);
    }
    return shard;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/control-state'
      ) {
        const snapshot = await readJsonBody<
          QuizControlStateSnapshot & { eventId?: string }
        >(request);
        const eventId =
          snapshot.eventId ?? url.searchParams.get('eventId') ?? undefined;
        if (eventId) {
          const shard = this.getEventShard(eventId);
          const applied = shard.controlState.applySnapshot(snapshot);
          return jsonResponse({
            ok: true,
            applied,
            version: shard.controlState.getVersion(),
          });
        }
        const applied = this.defaultControlState.applySnapshot(snapshot);
        for (const shard of this.eventShards.values()) {
          shard.controlState.applySnapshot(snapshot);
        }
        return jsonResponse({
          ok: true,
          applied,
          version: this.defaultControlState.getVersion(),
        });
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/materialize'
      ) {
        const body = await readJsonBody<{
          eventMeta: PublishedShardEventMetadata;
          records: readonly QuizPrivateResultRecord[];
        }>(request);
        this.defaultEngine.materializeResultsBatch(
          body.eventMeta,
          body.records
        );
        return jsonResponse({ ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/internal/result') {
        const body = await readJsonBody<{
          attemptId: string;
          callerUserId: string;
          authorizationHeader?: string;
        }>(request);
        const eventId = this.defaultEngine.getEventIdForAttempt(body.attemptId);
        const engine = eventId
          ? (await this.refreshControlStateIfStale(eventId, Date.now())).engine
          : this.defaultEngine;
        return jsonResponse(
          await engine.getAttemptResult({
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
        const { engine } = await this.refreshControlStateIfStale(
          body.eventId,
          Date.now()
        );
        return jsonResponse(await engine.getPublishedLeaderboard(body));
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
          const stub = getWeurStub(env.QUIZ_ROOM, roomId);
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
          const manifest = (await res.json()) as ReturnType<
            QuizRoomEngine['seal']
          > extends Promise<infer R>
            ? R
            : never;
          const uuidRe =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRe.test(eventId)) {
            if (
              !env.SUPABASE_URL?.startsWith('https://') ||
              !env.QUIZ_BATCH_WORKER_JWT
            ) {
              throw new QuizRoomError(
                'QUIZ_CONFIG_MISSING',
                'HTTPS SUPABASE_URL and QUIZ_BATCH_WORKER_JWT are required to persist room seal',
                503
              );
            }
            const sealUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/record_quiz_edge_room_seal_v2`;
            const sealRes = await fetch(sealUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.QUIZ_BATCH_WORKER_JWT}`,
                apikey: env.SUPABASE_ANON_KEY ?? env.QUIZ_BATCH_WORKER_JWT,
              },
              body: JSON.stringify({
                p_event_id: manifest.eventId,
                p_room_id: manifest.roomId,
                p_persisted_close_at: new Date(
                  manifest.persistedCloseAtMs
                ).toISOString(),
                p_event_status: manifest.eventStatus,
                p_attempt_count: manifest.attemptCount,
                p_answer_count: manifest.answerCount,
                p_batch_ids: manifest.batchIds,
                p_batch_count: manifest.batchCount,
                p_room_checksum_sha256: manifest.roomChecksumSha256,
              }),
            });
            if (!sealRes.ok) {
              throw new QuizRoomError(
                'QUIZ_SEAL_PERSIST_FAILED',
                `Failed to persist room seal ${manifest.roomId} to Supabase (${sealRes.status})`,
                502
              );
            }
          }
          return manifest;
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
      if (
        request.method === 'GET' &&
        url.pathname === '/internal/control-state'
      ) {
        const eventId = url.searchParams.get('eventId');
        if (!eventId) {
          throw new QuizRoomError(
            'QUIZ_INVALID_INPUT',
            'eventId query parameter is required',
            400
          );
        }
        const snapshot = this.engine.getControlState(eventId);
        if (!snapshot) {
          return jsonResponse(
            { error: 'Control state not initialized', code: 'NOT_FOUND' },
            404
          );
        }
        return jsonResponse(snapshot);
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/control-state'
      ) {
        const body = await readJsonBody<{
          eventId: string;
          snapshot: QuizControlStateSnapshot;
        }>(request);
        return jsonResponse(
          this.engine.setControlState(body.eventId, body.snapshot)
        );
      }
      if (
        request.method === 'POST' &&
        url.pathname === '/internal/control-state/refresh'
      ) {
        const body = await readJsonBody<{
          eventId: string;
          updatedAtMs?: number;
        }>(request);
        return jsonResponse(
          this.engine.refreshControlStateFreshness(
            body.eventId,
            body.updatedAtMs ?? Date.now()
          )
        );
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

export class DemoStateDO extends DurableObject<WorkerEnv> {
  private readonly engine: DemoStateEngine;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const adapter = new CloudflareSqlStorageAdapter(
      ctx.storage as unknown as CloudflareDoStorageLike
    );
    this.engine = new DemoStateEngine(adapter);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/internal/demo/setup-round') {
        const state = await readJsonBody<DemoRoundState>(request);
        this.engine.setActiveRound(state);
        return jsonResponse({ ok: true, ...state });
      }
      if (url.pathname === '/internal/demo/active') {
        return jsonResponse(this.engine.getActiveRound());
      }
      if (url.pathname === '/internal/demo/reconciled') {
        const body = await readJsonBody<{
          eventId: string;
          publishedAtMs: number;
        }>(request);
        this.engine.markRoundReconciled(body.eventId, body.publishedAtMs);
        return jsonResponse({ ok: true });
      }
      if (url.pathname === '/internal/demo/check-in') {
        const body = await readJsonBody<{ roomId?: string }>(request);
        return jsonResponse(this.engine.allocateCheckIn(body.roomId));
      }
      if (url.pathname === '/internal/demo/telemetry') {
        const body = await readJsonBody<DemoTelemetryInput>(request);
        const result = this.engine.recordTelemetry(body, Date.now());
        return jsonResponse({ ok: true, ...result });
      }
      if (url.pathname === '/internal/demo/report') {
        return jsonResponse(this.engine.buildReport(Date.now()));
      }
      return jsonResponse({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }
}

function getShardCount(env: WorkerEnv): number {
  const parsed = Number.parseInt(env.RESULT_SHARD_COUNT ?? '16', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 16;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      const demoRes = await handleDemoWorkerRoute(request, url, {
        QUIZ_TICKET_SECRET: env.QUIZ_TICKET_SECRET,
        QUIZ_JWT_SECRET: env.QUIZ_JWT_SECRET,
        QUIZ_INTERNAL_COORDINATOR_SECRET: env.QUIZ_INTERNAL_COORDINATOR_SECRET,
        QUIZ_DEMO_INVITE_CODE: env.QUIZ_DEMO_INVITE_CODE,
        RESULT_SHARD_COUNT: env.RESULT_SHARD_COUNT,
        callDemoDo: (internalPath, body) => {
          const stub = getWeurStub(env.DEMO_STATE, DEMO_STATE_DO_NAME);
          return stub.fetch(`https://demo.internal${internalPath}`, {
            method: 'POST',
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          });
        },
        initRoom: async (roomId, config) => {
          const stub = getWeurStub(env.QUIZ_ROOM, roomId);
          const res = await stub.fetch('https://room.internal/internal/init', {
            method: 'POST',
            body: JSON.stringify(config),
          });
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_ROOM_INIT_FAILED',
              `Failed to init room ${roomId}`,
              res.status
            );
          }
        },
        freezeCoordinator: async (params) => {
          const stub = getWeurStub(env.EVENT_COORDINATOR, params.eventId);
          const res = await stub.fetch(
            'https://coord.internal/internal/freeze',
            {
              method: 'POST',
              body: JSON.stringify(params),
            }
          );
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_COORDINATOR_FREEZE_FAILED',
              `Failed to freeze coordinator for ${params.eventId}`,
              res.status
            );
          }
        },
        refreshControlState: async (eventId, updatedAtMs) => {
          const stub = getWeurStub(env.EVENT_COORDINATOR, eventId);
          const res = await stub.fetch(
            'https://coord.internal/internal/control-state/refresh',
            {
              method: 'POST',
              body: JSON.stringify({ eventId, updatedAtMs }),
            }
          );
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_COORDINATOR_CS_FAILED',
              `Failed to refresh control state for ${eventId}`,
              res.status
            );
          }
        },
        freezeAndSweepCoordinator: async ({
          eventId,
          endsAtMs,
          roomIds,
          nowMs,
        }) => {
          const stub = getWeurStub(env.EVENT_COORDINATOR, eventId);
          const freezeRes = await stub.fetch(
            'https://coord.internal/internal/freeze',
            {
              method: 'POST',
              body: JSON.stringify({
                eventId,
                endsAtMs,
                expectedRoomIds: roomIds,
              }),
            }
          );
          if (!freezeRes.ok) {
            throw new QuizRoomError(
              'QUIZ_COORDINATOR_FREEZE_FAILED',
              `Failed to freeze coordinator for ${eventId}`,
              freezeRes.status
            );
          }
          const sweepRes = await stub.fetch(
            'https://coord.internal/internal/sweep',
            {
              method: 'POST',
              body: JSON.stringify({ eventId, nowMs }),
            }
          );
          if (!sweepRes.ok) {
            throw new QuizRoomError(
              'QUIZ_COORDINATOR_SWEEP_FAILED',
              `Failed to sweep coordinator for ${eventId}`,
              sweepRes.status
            );
          }
          return (await sweepRes.json()) as {
            persistedCloseAtMs: number | null;
            allRoomsSealed: boolean;
          };
        },
        fetchRoomBundles: async (roomId) => {
          const stub = getWeurStub(env.QUIZ_ROOM, roomId);
          const res = await stub.fetch(
            'https://room.internal/internal/batches',
            {
              method: 'POST',
            }
          );
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_ROOM_BUNDLES_FAILED',
              `Failed to read bundles for room ${roomId}`,
              res.status
            );
          }
          const data = (await res.json()) as { bundles?: QuizAttemptBundle[] };
          return data.bundles ?? [];
        },
        materializeShard: async (shardName, eventMeta, records) => {
          const stub = getWeurStub(env.RESULT_SHARD, shardName);
          const res = await stub.fetch(
            'https://shard.internal/internal/materialize',
            {
              method: 'POST',
              body: JSON.stringify({ eventMeta, records }),
            }
          );
          if (!res.ok) {
            throw new QuizRoomError(
              'QUIZ_SHARD_MATERIALIZE_FAILED',
              `Failed to materialize shard ${shardName}`,
              res.status
            );
          }
        },
        markRoundReconciled: async (eventId, publishedAtMs) => {
          const stub = getWeurStub(env.DEMO_STATE, DEMO_STATE_DO_NAME);
          await stub.fetch('https://demo.internal/internal/demo/reconciled', {
            method: 'POST',
            body: JSON.stringify({ eventId, publishedAtMs }),
          });
        },
      });
      if (demoRes) return demoRes;

      if (request.method === 'POST' && path === '/api/quiz/admin/init-rooms') {
        verifyInternalCoordinatorAuth(
          request.headers.get('Authorization'),
          env.QUIZ_INTERNAL_COORDINATOR_SECRET
        );
        const body = await readJsonBody<{
          roomIds: readonly string[];
          config: QuizEventConfig;
        }>(request);
        await Promise.all(
          body.roomIds.map(async (roomId) => {
            const stub = getWeurStub(env.QUIZ_ROOM, roomId);
            const res = await stub.fetch(
              'https://room.internal/internal/init',
              {
                method: 'POST',
                body: JSON.stringify(body.config),
              }
            );
            if (!res.ok) {
              throw new QuizRoomError(
                'QUIZ_ROOM_INIT_FAILED',
                `Failed to init room ${roomId}`,
                res.status
              );
            }
          })
        );
        const coordStub = getWeurStub(
          env.EVENT_COORDINATOR,
          body.config.eventId
        );
        const freezeRes = await coordStub.fetch(
          'https://coord.internal/internal/freeze',
          {
            method: 'POST',
            body: JSON.stringify({
              eventId: body.config.eventId,
              endsAtMs: body.config.endsAtMs,
              expectedRoomIds: body.roomIds,
            }),
          }
        );
        if (!freezeRes.ok) {
          throw new QuizRoomError(
            'QUIZ_COORDINATOR_FREEZE_FAILED',
            `Failed to freeze coordinator for ${body.config.eventId}`,
            freezeRes.status
          );
        }
        const refreshRes = await coordStub.fetch(
          'https://coord.internal/internal/control-state/refresh',
          {
            method: 'POST',
            body: JSON.stringify({
              eventId: body.config.eventId,
              updatedAtMs: Date.now(),
            }),
          }
        );
        if (!refreshRes.ok) {
          throw new QuizRoomError(
            'QUIZ_CONTROL_STATE_REFRESH_FAILED',
            `Failed to refresh coordinator control state for ${body.config.eventId}`,
            refreshRes.status
          );
        }
        return jsonResponse({
          ok: true,
          eventId: body.config.eventId,
          roomCount: body.roomIds.length,
        });
      }

      if (request.method === 'POST' && path === '/api/quiz/admin/seal-room') {
        verifyInternalCoordinatorAuth(
          request.headers.get('Authorization'),
          env.QUIZ_INTERNAL_COORDINATOR_SECRET
        );
        const body = await readJsonBody<{
          roomId: string;
          eventId: string;
          endsAtMs: number;
          persistedCloseAtMs: number;
          mode?: QuizRoomSealMode;
        }>(request);
        const roomStub = getWeurStub(env.QUIZ_ROOM, body.roomId);
        return roomStub.fetch('https://room.internal/internal/seal', {
          method: 'POST',
          body: JSON.stringify({
            eventId: body.eventId,
            endsAtMs: body.endsAtMs,
            persistedCloseAtMs: body.persistedCloseAtMs,
            mode: body.mode ?? 'persisted_close',
          }),
        });
      }

      if (
        request.method === 'POST' &&
        path === '/api/quiz/admin/control-state'
      ) {
        verifyInternalCoordinatorAuth(
          request.headers.get('Authorization'),
          env.QUIZ_INTERNAL_COORDINATOR_SECRET
        );
        const body = await readJsonBody<{
          eventId: string;
          snapshot: QuizControlStateSnapshot;
        }>(request);
        const coordStub = getWeurStub(env.EVENT_COORDINATOR, body.eventId);
        return coordStub.fetch(
          'https://coord.internal/internal/control-state',
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        );
      }

      if (request.method === 'POST' && path === '/api/quiz/coordinator/sweep') {
        verifyInternalCoordinatorAuth(
          request.headers.get('Authorization'),
          env.QUIZ_INTERNAL_COORDINATOR_SECRET
        );
        const body = await readJsonBody<{
          eventId: string;
          mode?: QuizRoomSealMode;
          maxRoomsPerSweep?: number;
        }>(request);
        const coordStub = getWeurStub(env.EVENT_COORDINATOR, body.eventId);
        return coordStub.fetch('https://coord.internal/internal/sweep', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      if (
        request.method === 'POST' &&
        path === '/api/quiz/coordinator/freeze'
      ) {
        verifyInternalCoordinatorAuth(
          request.headers.get('Authorization'),
          env.QUIZ_INTERNAL_COORDINATOR_SECRET
        );
        const body = await readJsonBody<{
          eventId: string;
          endsAtMs: number;
          expectedRoomIds: readonly string[];
        }>(request);
        const coordStub = getWeurStub(env.EVENT_COORDINATOR, body.eventId);
        return coordStub.fetch('https://coord.internal/internal/freeze', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      const startMatch = /^\/api\/quiz\/events\/([^/]+)\/start$/.exec(path);
      if (request.method === 'POST' && startMatch?.[1]) {
        const eventId = startMatch[1];
        const ticketSecret = requireConfiguredSecret(
          env.QUIZ_TICKET_SECRET,
          'QUIZ_TICKET_SECRET'
        );
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
        const ticket = await verifyAdmissionTicket(ticketHeader, {
          secret: ticketSecret,
          expectedEventId: eventId,
          nowMs: Date.now(),
        });
        const rawBody = await readJsonBody<Record<string, unknown>>(request);
        const startRequestId =
          typeof rawBody.startRequestId === 'string'
            ? rawBody.startRequestId.trim()
            : '';
        const acceptedRulesVersion =
          typeof rawBody.acceptedRulesVersion === 'string'
            ? rawBody.acceptedRulesVersion.trim()
            : '';
        const appVersion =
          typeof rawBody.appVersion === 'string'
            ? rawBody.appVersion.trim()
            : '';
        const integrityTier = rawBody.integrityTier;
        const platform = rawBody.platform;
        const termsAccepted = rawBody.termsAccepted;
        const UUID_RE =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (
          !UUID_RE.test(startRequestId) ||
          !acceptedRulesVersion ||
          acceptedRulesVersion.length > 64 ||
          !appVersion ||
          appVersion.length > 64 ||
          typeof termsAccepted !== 'boolean' ||
          (integrityTier !== 'basic' &&
            integrityTier !== 'device' &&
            integrityTier !== 'strong') ||
          (platform !== 'android' && platform !== 'ios' && platform !== 'web')
        ) {
          throw new QuizRoomError(
            'QUIZ_INVALID_INPUT',
            'Invalid start payload: startRequestId must be a UUID and integrityTier, acceptedRulesVersion, termsAccepted, appVersion, platform must be valid',
            400
          );
        }
        const body: {
          integrityTier: QuizIntegrityTier;
          acceptedRulesVersion: string;
          termsAccepted: boolean;
          startRequestId: string;
          appVersion: string;
          platform: QuizPlatform;
        } = {
          integrityTier,
          acceptedRulesVersion,
          termsAccepted,
          startRequestId,
          appVersion,
          platform,
        };
        const roomStub = getWeurStub(env.QUIZ_ROOM, ticket.roomId);
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
        const ticketSecret = requireConfiguredSecret(
          env.QUIZ_TICKET_SECRET,
          'QUIZ_TICKET_SECRET'
        );
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
        const ticket = await verifyAdmissionTicket(ticketHeader, {
          secret: ticketSecret,
          nowMs: Date.now(),
        });
        const body = await readJsonBody<Record<string, unknown>>(request);
        const questionId =
          typeof body.questionId === 'string' ? body.questionId.trim() : '';
        const answer =
          typeof body.answer === 'string' ? body.answer.trim() : '';
        if (
          !questionId ||
          questionId.length > 128 ||
          questionId.includes('\u0000') ||
          !answer ||
          answer.length > 1024 ||
          answer.includes('\u0000')
        ) {
          throw new QuizRoomError(
            'QUIZ_INVALID_INPUT',
            'questionId (1..128 chars) and answer (1..1024 chars) are required without NUL bytes',
            400
          );
        }
        const roomStub = getWeurStub(env.QUIZ_ROOM, ticket.roomId);
        return roomStub.fetch('https://room.internal/internal/answer', {
          method: 'POST',
          body: JSON.stringify({
            ticket,
            attemptId,
            questionId,
            answer,
          }),
        });
      }

      const activeMatch = /^\/api\/quiz\/attempts\/([^/]+)\/active$/.exec(path);
      if (
        request.method === 'GET' &&
        (path === '/api/quiz/attempts/active' || activeMatch?.[1])
      ) {
        const ticketSecret = requireConfiguredSecret(
          env.QUIZ_TICKET_SECRET,
          'QUIZ_TICKET_SECRET'
        );
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket') ?? '';
        const expectedEventId = url.searchParams.get('eventId') ?? undefined;
        const ticket = await verifyAdmissionTicket(ticketHeader, {
          secret: ticketSecret,
          expectedEventId,
          nowMs: Date.now(),
        });
        const roomStub = getWeurStub(env.QUIZ_ROOM, ticket.roomId);
        return roomStub.fetch('https://room.internal/internal/resume', {
          method: 'POST',
          body: JSON.stringify({ ticket }),
        });
      }

      const resultMatch = /^\/api\/quiz\/attempts\/([^/]+)\/result$/.exec(path);
      if (request.method === 'GET' && resultMatch?.[1]) {
        const attemptId = resultMatch[1];
        const jwtSecret = requireConfiguredSecret(
          env.QUIZ_JWT_SECRET,
          'QUIZ_JWT_SECRET'
        );
        const user = await verifyBearerJwt(
          request.headers.get('Authorization'),
          { secret: jwtSecret, nowMs: Date.now() }
        );
        const shardIdx = await computeResultShardIndex(
          attemptId,
          user.userId,
          getShardCount(env)
        );
        const shardStub = getWeurStub(
          env.RESULT_SHARD,
          `attempt-shard:${shardIdx}`
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
        const jwtSecret = requireConfiguredSecret(
          env.QUIZ_JWT_SECRET,
          'QUIZ_JWT_SECRET'
        );
        const user = await verifyBearerJwt(
          request.headers.get('Authorization'),
          { secret: jwtSecret, nowMs: Date.now() }
        );
        if (!user.merchantId || !user.customerId) {
          throw new QuizRoomError(
            'QUIZ_JWT_CLAIMS_MISSING',
            'Bearer JWT missing required merchantId or customerId claims',
            403
          );
        }
        const shardIdx = await computeResultShardIndex(
          eventId,
          user.userId,
          getShardCount(env)
        );
        const shardStub = getWeurStub(
          env.RESULT_SHARD,
          `${eventId}:shard:${shardIdx}`
        );
        return shardStub.fetch('https://shard.internal/internal/leaderboard', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            callerUserId: user.userId,
            callerCustomerId: user.customerId,
            callerMerchantId: user.merchantId,
          }),
        });
      }

      if (request.method === 'GET' && path === '/api/quiz/leaderboard/live') {
        const eventId = url.searchParams.get('eventId');
        if (!eventId) {
          throw new QuizRoomError(
            'QUIZ_INVALID_INPUT',
            'eventId query parameter is required',
            400
          );
        }
        const ticketHeader = request.headers.get('X-Baci-Quiz-Ticket');
        let merchantId: string;
        let customerId: string;
        let userId: string;
        if (ticketHeader) {
          const ticketSecret = requireConfiguredSecret(
            env.QUIZ_TICKET_SECRET,
            'QUIZ_TICKET_SECRET'
          );
          const ticket = await verifyAdmissionTicket(ticketHeader, {
            secret: ticketSecret,
            expectedEventId: eventId,
            nowMs: Date.now(),
          });
          merchantId = ticket.merchantId;
          customerId = ticket.customerId;
          userId = ticket.userId;
        } else {
          const jwtSecret = requireConfiguredSecret(
            env.QUIZ_JWT_SECRET,
            'QUIZ_JWT_SECRET'
          );
          const user = await verifyBearerJwt(
            request.headers.get('Authorization'),
            { secret: jwtSecret, nowMs: Date.now() }
          );
          if (!user.merchantId || !user.customerId) {
            throw new QuizRoomError(
              'QUIZ_JWT_CLAIMS_MISSING',
              'Bearer JWT missing required merchantId or customerId claims',
              403
            );
          }
          merchantId = user.merchantId;
          customerId = user.customerId;
          userId = user.userId;
        }
        const rankStub = getWeurStub(env.LIVE_RANK_INDEX, eventId);
        return rankStub.fetch('https://rank.internal/internal/leaderboard', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            merchantId,
            callerCustomerId: customerId,
            callerUserId: userId,
          }),
        });
      }

      const statusMatch = /^\/api\/quiz\/events\/([^/]+)\/status$/.exec(path);
      if (request.method === 'GET' && statusMatch?.[1]) {
        const eventId = statusMatch[1];
        const coordStub = getWeurStub(env.EVENT_COORDINATOR, eventId);
        const csRes = await coordStub.fetch(
          `https://coord.internal/internal/control-state?eventId=${encodeURIComponent(eventId)}`
        );
        if (!csRes.ok) {
          return jsonResponse(
            {
              error: 'Coordinator status unavailable',
              code: 'QUIZ_STATUS_UNAVAILABLE',
            },
            503
          );
        }
        const snapshot = (await csRes.json()) as QuizControlStateSnapshot;
        const pub = snapshot?.publishedEvents?.[eventId];
        const cancelled =
          Boolean(snapshot?.cancelledEvents?.[eventId]) ||
          pub?.eventStatus === 'cancelled';
        return jsonResponse(
          {
            eventId,
            status: cancelled ? 'cancelled' : pub ? 'completed' : 'active',
            resultsPublishedAt:
              !cancelled && pub
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

  async queue(batch: MessageBatch<unknown>, env: WorkerEnv): Promise<void> {
    await handleQuizQueueBatch(batch as QuizQueueBatchLike, env);
  },
};
