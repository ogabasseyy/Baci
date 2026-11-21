import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { BillingCounters } from '../src/contracts';
import {
  priceCloudflareUsage,
  priceSupabaseIncrementalAuthUsd,
} from './pricing-model';
import {
  type OneMillionQueueAndResultsProofResult,
  run1mQueueAndResultsProof,
} from './proof-1m-queue-results';
import {
  type FiveKChaosProofResult,
  runFiveKChaosProof,
} from './proof-5k-chaos';
import {
  type HundredKGameplayProofResult,
  run100kGameplayProof,
} from './proof-100k-gameplay';
import {
  runSingleRoomSaturationProof,
  type SingleRoomProofResult,
} from './proof-single-room';

export interface MeasuredEventProjection {
  entrants: number;
  rooms: number;
  resultShards: number;
  counters: BillingCounters;
  activeRoomHours: number;
  activeShardHours: number;
  sqliteStorageGbMonths: number;
  cfWithAllowancesExactUsd: number;
  cfWithAllowancesRoundedUsd: number;
  cfExhaustedAllowancesExactUsd: number;
  cfExhaustedAllowancesRoundedUsd: number;
  supabaseAuthReturningUsd: number;
  supabaseAuthNewlyActiveEmptyCycleUsd: number;
}

export interface BenchmarkReportPayload {
  generatedAtIso: string;
  wallDurationSeconds: number;
  singleRoom: SingleRoomProofResult;
  fiveKChaos: FiveKChaosProofResult;
  hundredKGameplay: HundredKGameplayProofResult;
  oneMillionQueueAndResults: OneMillionQueueAndResultsProofResult;
  costProjections: {
    event100k: MeasuredEventProjection;
    event1m: MeasuredEventProjection;
  };
}

function buildMeasuredEventProjection(options: {
  entrants: number;
  rooms: number;
  resultShards: number;
  roomRowsWrittenPerEntrant: number;
  roomRowsReadPerEntrant: number;
  liveRankRowsWrittenTotal: number;
  shardRowsWrittenPerEntrant: number;
  shardRowsReadPerEntrant: number;
  queueMessagesPerEntrant: number;
  queueOpsPerMessage: number;
  bytesPackedPerEntrant: number;
}): MeasuredEventProjection {
  // Worker invocations per entrant:
  // 1 admission/ticket check-in + 1 start + 10 answers + 3 live-rank polls +
  // 2 result/leaderboard reads + 0.25 queue/coord overhead = ~17.25 Worker reqs
  // (plus 12.25 DO room reqs + 2 result-shard reqs + live-rank ticks).
  const workerInvocations = Math.round(options.entrants * 17.5);
  const workerCpuMs = Math.round(workerInvocations * 2.5);
  const roomRequests = Math.round(options.entrants * 14.5 + options.rooms * 40);
  const rowsWritten = Math.round(
    options.entrants * options.roomRowsWrittenPerEntrant +
      options.liveRankRowsWrittenTotal +
      options.entrants * options.shardRowsWrittenPerEntrant +
      options.rooms * 6
  );
  const rowsRead = Math.round(
    options.entrants * options.roomRowsReadPerEntrant +
      options.entrants * options.shardRowsReadPerEntrant +
      options.entrants * 3 // live-rank reads
  );
  const queueMessages = Math.round(
    options.entrants * options.queueMessagesPerEntrant
  );
  const queueOperations = Math.round(
    queueMessages * options.queueOpsPerMessage
  );
  const bytesPacked = Math.round(
    options.entrants * options.bytesPackedPerEntrant
  );

  // Active room window: 10-min event + 1-min seal/flush = 0.20 active hours/room
  // (hibernating when idle). Result shards active for ~0.25h during publish+burst.
  const activeRoomHours = options.rooms * 0.25;
  const activeShardHours = options.resultShards * 0.25;
  const sqliteStorageGbMonths = (bytesPacked * 2.5) / 1_000_000_000;

  const counters: BillingCounters = {
    workerInvocations,
    workerCpuMs,
    roomRequests,
    rowsWritten,
    rowsRead,
    bytesPacked,
    queueMessages,
    queueOperations,
  };

  const withAllow = priceCloudflareUsage(
    {
      entrants: options.entrants,
      completions: options.entrants,
      counters,
      activeRoomHours,
      activeShardHours,
      sqliteStorageGbMonths,
    },
    true
  );
  const exhausted = priceCloudflareUsage(
    {
      entrants: options.entrants,
      completions: options.entrants,
      counters,
      activeRoomHours,
      activeShardHours,
      sqliteStorageGbMonths,
    },
    false
  );

  return {
    entrants: options.entrants,
    rooms: options.rooms,
    resultShards: options.resultShards,
    counters,
    activeRoomHours,
    activeShardHours,
    sqliteStorageGbMonths,
    cfWithAllowancesExactUsd: withAllow.totalExactUsd,
    cfWithAllowancesRoundedUsd: withAllow.totalWithPublishedDoRoundingUsd,
    cfExhaustedAllowancesExactUsd: exhausted.totalExactUsd,
    cfExhaustedAllowancesRoundedUsd: exhausted.totalWithPublishedDoRoundingUsd,
    supabaseAuthReturningUsd: 0,
    supabaseAuthNewlyActiveEmptyCycleUsd: priceSupabaseIncrementalAuthUsd(
      0,
      options.entrants
    ),
  };
}

export async function runAllStage1Benchmarks(): Promise<BenchmarkReportPayload> {
  const t0 = performance.now();
  const singleRoom = await runSingleRoomSaturationProof();
  const fiveKChaos = await runFiveKChaosProof();
  const hundredKGameplay = await run100kGameplayProof();
  const oneMillionQueueAndResults = await run1mQueueAndResultsProof();

  // Assert all critical correctness invariants.
  if (
    !fiveKChaos.sqlReferenceParityExact ||
    !fiveKChaos.withheldSealBlockedPublication ||
    !fiveKChaos.interruptedScoringBlockedPublication ||
    !fiveKChaos.missingBatchRecoveredFromJournal ||
    !fiveKChaos.crossRoomMsTieVerified ||
    fiveKChaos.neverOpenedAttemptsCount !== 0 ||
    fiveKChaos.recoveredAwardCount !== 1 ||
    fiveKChaos.cancelledAwardCount !== 0
  ) {
    throw new Error('5k chaos & recovery proof failed invariant checks');
  }
  if (
    !hundredKGameplay.liveRankTieCohort.sqlOrderParityExactDownToAttemptId ||
    !hundredKGameplay.liveRankTieCohort.blockedAttemptExcluded ||
    !hundredKGameplay.liveRankTieCohort.suppressedNameMasked ||
    !hundredKGameplay.liveRankTieCohort.crossMerchantIsolated ||
    hundredKGameplay.liveRankTieCohort.idleTickRowsWritten !== 0
  ) {
    throw new Error('100k live-rank tie cohort failed invariant checks');
  }
  if (
    !oneMillionQueueAndResults.queuePacking.allMessagesUnder64KbLimit ||
    !oneMillionQueueAndResults.queuePacking.oversizedChecksumReassembledOk ||
    !oneMillionQueueAndResults.queuePacking.duplicateAndLostRetryCountOnceOk ||
    !oneMillionQueueAndResults.resultDelivery.ticketlessNewDeviceLookupOk ||
    !oneMillionQueueAndResults.resultDelivery.crossUserIsolationRejectedOk ||
    !oneMillionQueueAndResults.resultDelivery
      .winnerPostCheckoutRefreshReflectedOk ||
    oneMillionQueueAndResults.resultDelivery.nonWinnerOriginCalls !== 0
  ) {
    throw new Error('1M queue & private result proof failed invariant checks');
  }

  const surgeProfile = hundredKGameplay.profiles.find(
    (p) => p.profile === 'surge_30s_50pct'
  );
  const roomRowsWrittenPerEntrant = surgeProfile
    ? surgeProfile.sampleRowsWritten / surgeProfile.sampleEntrants
    : singleRoom.rowsWrittenPerEntrantAtSafeSize;
  const roomRowsReadPerEntrant = surgeProfile
    ? surgeProfile.sampleRowsRead / surgeProfile.sampleEntrants
    : singleRoom.rowsReadPerEntrantAtSafeSize;

  const q = oneMillionQueueAndResults.queuePacking;
  const r = oneMillionQueueAndResults.resultDelivery;
  const shardRowsWrittenPerEntrant = r.resultShardRowsWrittenTotal / 1_000_000;
  const shardRowsReadPerEntrant = r.resultShardRowsReadTotal / 1_000_000;

  const event100k = buildMeasuredEventProjection({
    entrants: 100_000,
    rooms: 200,
    resultShards: 16,
    roomRowsWrittenPerEntrant,
    roomRowsReadPerEntrant,
    liveRankRowsWrittenTotal:
      hundredKGameplay.liveRankTieCohort.totalRangeRowsWritten,
    shardRowsWrittenPerEntrant,
    shardRowsReadPerEntrant,
    queueMessagesPerEntrant: q.sampleMessagesPacked / q.sampleEntrants,
    queueOpsPerMessage: q.avgOpsPerMessage,
    bytesPackedPerEntrant: q.projected1mBytesPacked / 1_000_000,
  });

  const event1m = buildMeasuredEventProjection({
    entrants: 1_000_000,
    rooms: 2_000,
    resultShards: 64,
    roomRowsWrittenPerEntrant,
    roomRowsReadPerEntrant,
    // 1M entrants across 1,000 ranges x 20 ticks -> ~200k range writes + 1M submission rows
    liveRankRowsWrittenTotal:
      hundredKGameplay.liveRankTieCohort.totalRangeRowsWritten * 10,
    shardRowsWrittenPerEntrant,
    shardRowsReadPerEntrant,
    queueMessagesPerEntrant: q.sampleMessagesPacked / q.sampleEntrants,
    queueOpsPerMessage: q.avgOpsPerMessage,
    bytesPackedPerEntrant: q.projected1mBytesPacked / 1_000_000,
  });

  const report: BenchmarkReportPayload = {
    generatedAtIso: new Date().toISOString(),
    wallDurationSeconds: (performance.now() - t0) / 1000,
    singleRoom,
    fiveKChaos,
    hundredKGameplay,
    oneMillionQueueAndResults,
    costProjections: {
      event100k,
      event1m,
    },
  };

  return report;
}

async function main(): Promise<void> {
  const report = await runAllStage1Benchmarks();
  const entryDir = process.argv[1]
    ? path.dirname(path.resolve(process.argv[1]))
    : process.cwd();
  const outPath = path.resolve(entryDir, 'latest-results.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.endsWith('run-all.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
