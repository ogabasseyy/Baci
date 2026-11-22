import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import type { QuizPrivateResultRecord } from '../src/contracts';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from '../src/control-state';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import {
  type PublishedShardEventMetadata,
  ResultShardEngine,
} from '../src/result-shard';

export interface ShardWorkerTask {
  eventId: string;
  merchantId: string;
  publishedAtMs: number;
  endsAtMs: number;
  retentionExpiresAtMs: number;
  eventMeta: PublishedShardEventMetadata;
  shardIndices: readonly number[];
  attemptBuckets: Readonly<Record<number, readonly number[]>>;
  leaderboardBuckets: Readonly<Record<number, readonly number[]>>;
}

export interface ShardWorkerResult {
  attemptLookupsExecuted: number;
  leaderboardLookupsExecuted: number;
  attemptShardRowsWritten: number;
  attemptShardRowsRead: number;
  leaderboardShardRowsWritten: number;
  leaderboardShardRowsRead: number;
  resultLatencySamples: number[];
  leaderboardLatencySamples: number[];
  winnerOriginCalls: number;
  crossUserIsolationRejectedOk: boolean | null;
  winnerPostCheckoutRefreshReflectedOk: boolean | null;
  ticketlessAttemptLookupOk: boolean | null;
  ticketlessLeaderboardLookupOk: boolean | null;
}

async function runWorkerTask(
  task: ShardWorkerTask
): Promise<ShardWorkerResult> {
  let checkoutRedeemed = false;
  let winnerOriginCalls = 0;

  const shardHooks = {
    fetchWinnerAwardFromOrigin: () => {
      winnerOriginCalls += 1;
      return Promise.resolve({
        claim: {
          expiresAt: new Date(task.retentionExpiresAtMs).toISOString(),
          token: 'signed-claim-token-v2',
        },
        prizeClaim: {
          awardId: '11111111-1111-4111-8111-111111111111',
          cartPath: checkoutRedeemed
            ? '/cart?award=claimed'
            : '/cart?award=pending',
          condition: 'new' as const,
          productId: '22222222-2222-4222-8222-222222222222',
          variantId: null,
          voucherToken: checkoutRedeemed
            ? 'redeemed-voucher'
            : 'active-voucher',
        },
      });
    },
  };

  const controlState = new QuizControlStateStore({
    ...createEmptyControlState(task.publishedAtMs, 1),
    updatedAtMs: task.publishedAtMs,
  });

  const makeRecords = (indices: readonly number[]): QuizPrivateResultRecord[] =>
    indices.map((idx) => {
      const idStr = String(idx).padStart(7, '0');
      return {
        eventId: task.eventId,
        attemptId: `att-${idStr}`,
        merchantId: task.merchantId,
        userId: `user-${idStr}`,
        customerId: `cust-${idStr}`,
        leaderboardUsername: `player_${idStr}`,
        rank: idx,
        score: idx === 1 ? 10 : idx % 10,
        totalQuestions: 10,
        attemptStatus: 'scored',
        submittedAtMs: task.endsAtMs - 100_000 + (idx % 50_000),
        totalTimeSeconds: 20 + (idx % 120),
        hasAward: idx === 1,
        retentionExpiresAtMs: task.retentionExpiresAtMs,
      };
    });

  let attemptLookupsExecuted = 0;
  let leaderboardLookupsExecuted = 0;
  let attemptShardRowsWritten = 0;
  let attemptShardRowsRead = 0;
  let leaderboardShardRowsWritten = 0;
  let leaderboardShardRowsRead = 0;
  const resultLatencySamples: number[] = [];
  const leaderboardLatencySamples: number[] = [];
  let crossUserIsolationRejectedOk: boolean | null = null;
  let winnerPostCheckoutRefreshReflectedOk: boolean | null = null;
  let ticketlessAttemptLookupOk: boolean | null = null;
  let ticketlessLeaderboardLookupOk: boolean | null = null;

  for (const s of task.shardIndices) {
    // 1. Attempt projection shard routed by (attemptId, userId) mod S
    const attIndices = task.attemptBuckets[s] ?? [];
    const attAdapter = new NodeSqliteAdapter(':memory:');
    const attShard = new ResultShardEngine({
      shardIndex: s,
      storage: attAdapter,
      controlState,
      hooks: shardHooks,
    });
    attShard.materializeResultsBatch(task.eventMeta, makeRecords(attIndices));

    for (const idx of attIndices) {
      const idStr = String(idx).padStart(7, '0');
      const attemptId = `att-${idStr}`;
      const userId = `user-${idStr}`;
      const shouldTime = idx % 100 === 0;
      const t0 = shouldTime ? performance.now() : 0;
      const result = await attShard.getAttemptResult({
        attemptId,
        callerUserId: userId,
        nowMs: task.publishedAtMs + 5_000,
      });
      if (shouldTime) resultLatencySamples.push(performance.now() - t0);
      if (result.availability !== 'final' || result.rank !== idx) {
        throw new Error(`Attempt shard mismatch at user ${idx}`);
      }
      attemptLookupsExecuted += 1;

      if (idx === 1) {
        const spoofed = await attShard.getAttemptResult({
          attemptId,
          callerUserId: 'user-attacker-9999999',
          nowMs: task.publishedAtMs + 5_000,
        });
        crossUserIsolationRejectedOk =
          spoofed.availability === 'unavailable' &&
          spoofed.reason === 'not_found';

        checkoutRedeemed = true;
        const refreshed = await attShard.getAttemptResult({
          attemptId,
          callerUserId: userId,
          nowMs: task.publishedAtMs + 15_000,
        });
        winnerPostCheckoutRefreshReflectedOk =
          refreshed.availability === 'final' &&
          refreshed.prizeClaim?.voucherToken === 'redeemed-voucher';
      }
      if (idx === 500_000) {
        ticketlessAttemptLookupOk = result.rank === 500_000;
      }
    }
    const attCounters = attShard.getBillingCounters();
    attemptShardRowsWritten += attCounters.rowsWritten;
    attemptShardRowsRead += attCounters.rowsRead;
    attAdapter.close();

    // 2. Published leaderboard currentPlayer shard routed by (eventId, userId) mod S
    const lbIndices = task.leaderboardBuckets[s] ?? [];
    const lbAdapter = new NodeSqliteAdapter(':memory:');
    const lbShard = new ResultShardEngine({
      shardIndex: s,
      storage: lbAdapter,
      controlState,
      hooks: shardHooks,
    });
    lbShard.materializeResultsBatch(task.eventMeta, makeRecords(lbIndices));

    for (const idx of lbIndices) {
      const idStr = String(idx).padStart(7, '0');
      const userId = `user-${idStr}`;
      const customerId = `cust-${idStr}`;
      const shouldTime = idx % 100 === 0;
      const t0 = shouldTime ? performance.now() : 0;
      const lb = await lbShard.getPublishedLeaderboard({
        eventId: task.eventId,
        callerUserId: userId,
        callerCustomerId: customerId,
        callerMerchantId: task.merchantId,
      });
      if (shouldTime) leaderboardLatencySamples.push(performance.now() - t0);
      const matchedRank =
        idx <= 100
          ? lb.entries.find((e) => e.isCurrentCustomer)?.rank
          : lb.currentPlayer?.rank;
      if (lb.status !== 'published' || matchedRank !== idx) {
        throw new Error(`Leaderboard shard mismatch at user ${idx}`);
      }
      leaderboardLookupsExecuted += 1;

      if (idx === 500_000) {
        ticketlessLeaderboardLookupOk = matchedRank === 500_000;
      }
    }
    const lbCounters = lbShard.getBillingCounters();
    leaderboardShardRowsWritten += lbCounters.rowsWritten;
    leaderboardShardRowsRead += lbCounters.rowsRead;
    lbAdapter.close();
  }

  return {
    attemptLookupsExecuted,
    leaderboardLookupsExecuted,
    attemptShardRowsWritten,
    attemptShardRowsRead,
    leaderboardShardRowsWritten,
    leaderboardShardRowsRead,
    resultLatencySamples,
    leaderboardLatencySamples,
    winnerOriginCalls,
    crossUserIsolationRejectedOk,
    winnerPostCheckoutRefreshReflectedOk,
    ticketlessAttemptLookupOk,
    ticketlessLeaderboardLookupOk,
  };
}

if (parentPort && workerData) {
  runWorkerTask(workerData as ShardWorkerTask)
    .then((res) => parentPort?.postMessage(res))
    .catch((err: unknown) => {
      throw err;
    });
}
