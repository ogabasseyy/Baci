import type { QuizAttemptBundle, QuizPrivateResultRecord } from './contracts';
import { QuizRoomError } from './contracts';
import type { DemoRoundState } from './demo-state';
import { compareLiveRankKeys } from './live-rank';
import {
  computeResultShardIndex,
  type PublishedShardEventMetadata,
} from './result-shard';

export interface DemoFinalizerEnv {
  RESULT_SHARD_COUNT?: string;
  freezeAndSweepCoordinator(params: {
    eventId: string;
    endsAtMs: number;
    roomIds: readonly string[];
    nowMs: number;
  }): Promise<{
    persistedCloseAtMs: number | null;
    allRoomsSealed: boolean;
  }>;
  fetchRoomBundles(roomId: string): Promise<readonly QuizAttemptBundle[]>;
  materializeShard(
    shardName: string,
    eventMeta: PublishedShardEventMetadata,
    records: readonly QuizPrivateResultRecord[]
  ): Promise<void>;
  markRoundReconciled(publishedAtMs: number): Promise<void>;
}

export interface DemoReconcileResult {
  reconciled: boolean;
  mode: 'pending' | 'solo_instant' | 'group_sealed';
  eventId: string;
  endsAtMs: number;
  publishedAtMs: number | null;
  participantCount: number;
  topStandings: readonly {
    rank: number;
    displayName: string;
    score: number;
    elapsedMs: number;
  }[];
}

function resolveShardCount(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '16', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 16;
}

function selectBestAttemptsPerCustomer(
  bundles: readonly QuizAttemptBundle[]
): QuizAttemptBundle[] {
  const bestByCustomer = new Map<string, QuizAttemptBundle>();
  for (const bundle of bundles) {
    if (bundle.closeReason === 'event_cancelled') continue;
    if (bundle.closeReason === 'tester_revoked') continue;
    if (bundle.closeReason === 'disqualified') continue;
    const prev = bestByCustomer.get(bundle.customerId);
    const candidateKey = {
      score: bundle.score,
      elapsedMs: Math.max(0, bundle.submittedAtMs - bundle.startedAtMs),
      submittedAtMs: bundle.submittedAtMs,
      attemptId: bundle.attemptId,
    };
    if (!prev) {
      bestByCustomer.set(bundle.customerId, bundle);
      continue;
    }
    const prevKey = {
      score: prev.score,
      elapsedMs: Math.max(0, prev.submittedAtMs - prev.startedAtMs),
      submittedAtMs: prev.submittedAtMs,
      attemptId: prev.attemptId,
    };
    if (compareLiveRankKeys(candidateKey, prevKey) < 0) {
      bestByCustomer.set(bundle.customerId, bundle);
    }
  }
  return Array.from(bestByCustomer.values()).sort((a, b) =>
    compareLiveRankKeys(
      {
        score: a.score,
        elapsedMs: Math.max(0, a.submittedAtMs - a.startedAtMs),
        submittedAtMs: a.submittedAtMs,
        attemptId: a.attemptId,
      },
      {
        score: b.score,
        elapsedMs: Math.max(0, b.submittedAtMs - b.startedAtMs),
        submittedAtMs: b.submittedAtMs,
        attemptId: b.attemptId,
      }
    )
  );
}

/**
 * Reconciles a demo round (either `soloInstantResult` without sealing rooms, or
 * group timed round via `EventCoordinatorDO` sweep + `ResultShardDO` materialization).
 * Matches SQL v2 tiebreak order: `(score DESC, elapsedMs ASC, submittedAtMs ASC, attemptId ASC)`.
 */
export async function reconcileDemoRound(
  params: {
    round?: DemoRoundState | null;
    override?: {
      eventId: string;
      roomIds: readonly string[];
      endsAtMs?: number;
    };
    forceAdmin?: boolean;
    nowMs?: number;
  },
  env: DemoFinalizerEnv
): Promise<DemoReconcileResult> {
  const nowMs = params.nowMs ?? Date.now();
  const override = params.override;
  const round = params.round;

  if (!override && !round) {
    throw new QuizRoomError(
      'QUIZ_DEMO_ROUND_NOT_READY',
      'No active demo round to reconcile',
      409
    );
  }

  const eventId = override?.eventId ?? round?.eventId ?? '';
  const roomIds = override?.roomIds ?? round?.roomIds ?? [];
  const endsAtMs = override?.endsAtMs ?? round?.endsAtMs ?? nowMs;
  const soloInstant = !override && Boolean(round?.soloInstantResult);

  if (!soloInstant && !params.forceAdmin && nowMs < endsAtMs) {
    return {
      reconciled: false,
      mode: 'pending',
      eventId,
      endsAtMs,
      publishedAtMs: null,
      participantCount: 0,
      topStandings: [],
    };
  }

  let publishedAtMs = nowMs;
  if (!soloInstant) {
    const sweep = await env.freezeAndSweepCoordinator({
      eventId,
      endsAtMs,
      roomIds,
      nowMs,
    });
    if (!sweep.allRoomsSealed) {
      return {
        reconciled: false,
        mode: 'pending',
        eventId,
        endsAtMs,
        publishedAtMs: null,
        participantCount: 0,
        topStandings: [],
      };
    }
    publishedAtMs = sweep.persistedCloseAtMs ?? nowMs;
  }

  const perRoomBundles = await Promise.all(
    roomIds.map((roomId) => env.fetchRoomBundles(roomId))
  );
  const ranked = selectBestAttemptsPerCustomer(perRoomBundles.flat());
  const shardCount = resolveShardCount(env.RESULT_SHARD_COUNT);
  const retentionExpiresAtMs = publishedAtMs + 7 * 24 * 60 * 60 * 1000;
  const merchantId =
    ranked[0]?.merchantId ?? round?.merchantId ?? 'merch-ogabassey-demo';

  const top100 = ranked.slice(0, 100).map((b, idx) => ({
    attemptId: b.attemptId,
    customerId: b.customerId,
    userId: b.userId,
    leaderboardUsername: b.leaderboardUsername || `Player-${idx + 1}`,
    rank: idx + 1,
    score: b.score,
    status: 'scored',
    submittedAtMs: b.submittedAtMs,
    totalTimeSeconds: Math.max(0, b.submittedAtMs - b.startedAtMs) / 1000,
  }));

  const eventMeta: PublishedShardEventMetadata = {
    eventId,
    merchantId,
    mode: 'live',
    eventStatus: 'completed',
    publishedAtMs,
    endsAtMs,
    participantCount: ranked.length,
    top100,
    retentionExpiresAtMs,
  };

  const recordsByShard = new Map<string, QuizPrivateResultRecord[]>();
  const pushToShard = (shardName: string, rec: QuizPrivateResultRecord) => {
    let list = recordsByShard.get(shardName);
    if (!list) {
      list = [];
      recordsByShard.set(shardName, list);
    }
    list.push(rec);
  };

  for (let idx = 0; idx < ranked.length; idx += 1) {
    const b = ranked[idx];
    if (!b) continue;
    const record: QuizPrivateResultRecord = {
      eventId,
      merchantId: b.merchantId,
      attemptId: b.attemptId,
      userId: b.userId,
      customerId: b.customerId,
      leaderboardUsername: b.leaderboardUsername || `Player-${idx + 1}`,
      rank: idx + 1,
      score: b.score,
      totalQuestions: 10,
      attemptStatus: 'scored',
      submittedAtMs: b.submittedAtMs,
      totalTimeSeconds: Math.max(0, b.submittedAtMs - b.startedAtMs) / 1000,
      hasAward: false,
      retentionExpiresAtMs,
    };
    const [attemptShard, eventShard] = await Promise.all([
      computeResultShardIndex(b.attemptId, b.userId, shardCount),
      computeResultShardIndex(eventId, b.userId, shardCount),
    ]);
    pushToShard(`attempt-shard:${attemptShard}`, record);
    pushToShard(`${eventId}:shard:${eventShard}`, record);
  }

  for (let s = 0; s < shardCount; s += 1) {
    const eventShardName = `${eventId}:shard:${s}`;
    if (!recordsByShard.has(eventShardName)) {
      recordsByShard.set(eventShardName, []);
    }
  }

  await Promise.all(
    Array.from(recordsByShard.entries()).map(([shardName, records]) =>
      env.materializeShard(shardName, eventMeta, records)
    )
  );

  if (!override && !soloInstant) {
    await env.markRoundReconciled(publishedAtMs);
  }

  return {
    reconciled: true,
    mode: soloInstant ? 'solo_instant' : 'group_sealed',
    eventId,
    endsAtMs,
    publishedAtMs,
    participantCount: ranked.length,
    topStandings: top100.slice(0, 10).map((e) => ({
      rank: e.rank,
      displayName: e.leaderboardUsername,
      score: e.score,
      elapsedMs: Math.round((e.totalTimeSeconds ?? 0) * 1000),
    })),
  };
}
