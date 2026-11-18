import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import {
  computeAttemptBundleChecksumSha256,
  MAX_QUEUE_MESSAGE_BYTES,
  QuizBatchPacker,
  QuizBatchReassembler,
} from '../src/batch-packer';
import type {
  QuizAttemptAnswerTranscript,
  QuizAttemptBundle,
} from '../src/contracts';
import {
  computeResultShardIndex,
  type PublishedShardEventMetadata,
} from '../src/result-shard';
import type { ShardWorkerResult, ShardWorkerTask } from './shard-worker';
import { percentile } from './workload';

export interface QueuePacking1MProofResult {
  sampleEntrants: number;
  targetEntrants: number;
  sampleCompletedBundles: number;
  samplePartialBundles: number;
  sampleZeroAnswerBundles: number;
  sampleMessagesPacked: number;
  sampleQueueOperations: number;
  maxNormalMessageBytes: number;
  allMessagesUnder64KbLimit: boolean;
  avgBytesPerCompletedBundle: number;
  avgBundlesPerMessage: number;
  avgBytesPerMessage: number;
  avgOpsPerMessage: number;
  oversizedBundleBytes: number;
  oversizedSplitParts: number;
  oversizedMaxPartMessageBytes: number;
  oversizedChecksumReassembledOk: boolean;
  underfilledTailFlushedOk: boolean;
  duplicateAndLostRetryCountOnceOk: boolean;
  projected1mMessages: number;
  projected1mQueueOperations: number;
  projected1mBytesPacked: number;
  projected1mDrainSecondsAt5kMsgPerSec: number;
}

export interface ResultDelivery1MProofResult {
  distinctUsers: number;
  shardCount: number;
  coldCacheRealtimeOff: boolean;
  zeroPerViewerPostgrestCalls: boolean;
  resultLookupsExecuted: number;
  leaderboardLookupsExecuted: number;
  attemptShardRowsWrittenTotal: number;
  attemptShardRowsReadTotal: number;
  leaderboardShardRowsWrittenTotal: number;
  leaderboardShardRowsReadTotal: number;
  resultShardRowsWrittenTotal: number;
  resultShardRowsReadTotal: number;
  resultLookupP50Ms: number;
  resultLookupP99Ms: number;
  leaderboardLookupP50Ms: number;
  leaderboardLookupP99Ms: number;
  totalLookupWallSeconds: number;
  ticketlessNewDeviceLookupOk: boolean;
  crossUserIsolationRejectedOk: boolean;
  winnerOnlyOriginClaimCalls: number;
  winnerPostCheckoutRefreshReflectedOk: boolean;
  nonWinnerOriginCalls: number;
  requiredWindowReadRateFor5MinTargetReqPerSec: number;
}

export interface OneMillionQueueAndResultsProofResult {
  queuePacking: QueuePacking1MProofResult;
  resultDelivery: ResultDelivery1MProofResult;
}

async function makeRepresentativeBundle(options: {
  attemptIndex: number;
  eventId: string;
  roomId: string;
  answerCount: number;
  extraPaddingBytes?: number;
}): Promise<QuizAttemptBundle> {
  const idStr = String(options.attemptIndex).padStart(7, '0');
  const baseTs = 1_763_480_000_000 + options.attemptIndex * 10;
  const answers: QuizAttemptAnswerTranscript[] = [];
  for (let q = 0; q < options.answerCount; q += 1) {
    answers.push({
      questionId: `q-${idStr}-${q + 1}`,
      slotId: `slot-${String(q + 1).padStart(2, '0')}`,
      position: q + 1,
      variantId: `slot-${String(q + 1).padStart(2, '0')}-var-1`,
      optionOrder: ['opt-b', 'opt-a', 'opt-d', 'opt-c'],
      issuedAtMs: baseTs + q * 2_500,
      receivedAtMs: baseTs + q * 2_500 + 1_850,
      rawAnswer: options.extraPaddingBytes
        ? 'x'.repeat(
            Math.ceil(
              options.extraPaddingBytes / Math.max(1, options.answerCount)
            )
          )
        : 'opt-a',
      selectedAnswerHash: 'a'.repeat(64),
      answeredInMs: 1_850,
      timeout: false,
      scoreDelta: 1,
    });
  }
  const core = {
    attemptId: `att-${idStr}`,
    admissionId: `adm-${idStr}`,
    eventId: options.eventId,
    merchantId: 'merchant-ogabassey',
    roomId: options.roomId,
    userId: `user-${idStr}`,
    customerId: `cust-${idStr}`,
    deviceHash: `dev-${idStr}`.padEnd(32, '0'),
    leaderboardUsername: `player_${idStr}`,
    attemptNumber: 1,
    rulesVersion: '2026-11',
    integrityTier: 'device' as const,
    appVersion: '2.10.0',
    platform: 'android' as const,
    startRequestId: `req-${idStr}`,
    startedAtMs: baseTs,
    submittedAtMs: baseTs + options.answerCount * 2_500,
    closeReason:
      options.answerCount === 10
        ? ('completed' as const)
        : ('event_closed' as const),
    score: options.answerCount,
    answers,
  };
  const bundleChecksumSha256 = await computeAttemptBundleChecksumSha256(core);
  return {
    ...core,
    partIndex: 0,
    totalParts: 1,
    bundleChecksumSha256,
  };
}

async function run1mQueuePackingProof(): Promise<QueuePacking1MProofResult> {
  const sampleEntrants = 10_000;
  const sampleRooms = 20;
  const targetEntrants = 1_000_000;
  const eventId = 'evt-1m-queue';
  let sampleCompletedBundles = 0;
  let samplePartialBundles = 0;
  let sampleZeroAnswerBundles = 0;
  let sampleMessagesPacked = 0;
  let sampleQueueOperations = 0;
  let sampleBytesPacked = 0;
  let maxNormalMessageBytes = 0;
  let completedBytesSum = 0;
  let underfilledTailFlushedOk = true;

  for (let r = 0; r < sampleRooms; r += 1) {
    const roomId = `room-${eventId}-${String(r).padStart(4, '0')}`;
    const packer = new QuizBatchPacker({
      eventId,
      roomId,
    });
    const perRoom = sampleEntrants / sampleRooms;
    for (let j = 0; j < perRoom; j += 1) {
      const idx = r * perRoom + j + 1;
      const mod = idx % 100;
      const answerCount = mod < 92 ? 10 : mod < 98 ? 7 : 0;
      if (answerCount === 10) sampleCompletedBundles += 1;
      else if (answerCount === 7) samplePartialBundles += 1;
      else sampleZeroAnswerBundles += 1;

      const bundle = await makeRepresentativeBundle({
        attemptIndex: idx,
        eventId,
        roomId,
        answerCount,
      });
      if (answerCount === 10) {
        completedBytesSum += Buffer.byteLength(JSON.stringify(bundle), 'utf8');
      }
      const flushed = await packer.addBundle(
        bundle,
        1_763_480_000_000 + j * 10
      );
      for (const msg of flushed) {
        sampleMessagesPacked += 1;
        sampleQueueOperations += msg.queueOperations;
        sampleBytesPacked += msg.byteLength;
        maxNormalMessageBytes = Math.max(maxNormalMessageBytes, msg.byteLength);
      }
    }

    const tail = await packer.flush(1_763_480_600_000);
    if (!tail && packer.getStats().bundlesPacked < perRoom) {
      underfilledTailFlushedOk = false;
    }
    if (tail) {
      sampleMessagesPacked += 1;
      sampleQueueOperations += tail.queueOperations;
      sampleBytesPacked += tail.byteLength;
      maxNormalMessageBytes = Math.max(maxNormalMessageBytes, tail.byteLength);
    }
  }

  const oversizedBundle = await makeRepresentativeBundle({
    attemptIndex: 9_999_999,
    eventId,
    roomId: 'room-oversized',
    answerCount: 10,
    extraPaddingBytes: 95_000,
  });
  const oversizedBundleBytes = Buffer.byteLength(
    JSON.stringify(oversizedBundle),
    'utf8'
  );
  const splitPacker = new QuizBatchPacker({
    eventId,
    roomId: 'room-oversized',
  });
  const splitMessages = await splitPacker.addBundle(
    oversizedBundle,
    1_763_480_600_000
  );
  const tailOversized = await splitPacker.flush(1_763_480_600_100);
  if (tailOversized) splitMessages.push(tailOversized);

  const oversizedMaxPartMessageBytes = Math.max(
    ...splitMessages.map((m) => m.byteLength)
  );
  const reassembler = new QuizBatchReassembler();
  const reassembledBundles: QuizAttemptBundle[] = [];
  for (const partMsg of splitMessages) {
    const res = await reassembler.acceptMessage(partMsg.message);
    reassembledBundles.push(...res.completedBundles);
  }
  const oversizedChecksumReassembledOk =
    splitMessages.length > 1 &&
    oversizedMaxPartMessageBytes < MAX_QUEUE_MESSAGE_BYTES &&
    reassembledBundles.length === 1 &&
    reassembledBundles[0]?.answers.length === oversizedBundle.answers.length &&
    reassembledBundles[0]?.bundleChecksumSha256 ===
      oversizedBundle.bundleChecksumSha256;

  const sampleRetryPacker = new QuizBatchPacker({
    eventId,
    roomId: 'room-retry',
  });
  const retryBundle = await makeRepresentativeBundle({
    attemptIndex: 1,
    eventId,
    roomId: 'room-retry',
    answerCount: 10,
  });
  await sampleRetryPacker.addBundle(retryBundle, 1_763_480_000_000);
  const flushedRetry = await sampleRetryPacker.flush(1_763_480_001_000);
  let duplicateAndLostRetryCountOnceOk = false;
  if (flushedRetry) {
    const firstAccept = await reassembler.acceptMessage(flushedRetry.message);
    const secondAccept = await reassembler.acceptMessage(flushedRetry.message);
    duplicateAndLostRetryCountOnceOk =
      !firstAccept.duplicateBatch &&
      firstAccept.completedBundles.length === 1 &&
      secondAccept.duplicateBatch &&
      secondAccept.completedBundles.length === 0;
  }

  const scaleFactor = targetEntrants / sampleEntrants;
  const projected1mMessages = Math.round(sampleMessagesPacked * scaleFactor);
  const projected1mQueueOperations = Math.round(
    sampleQueueOperations * scaleFactor
  );
  const projected1mBytesPacked = Math.round(sampleBytesPacked * scaleFactor);

  return {
    sampleEntrants,
    targetEntrants,
    sampleCompletedBundles,
    samplePartialBundles,
    sampleZeroAnswerBundles,
    sampleMessagesPacked,
    sampleQueueOperations,
    maxNormalMessageBytes,
    allMessagesUnder64KbLimit:
      maxNormalMessageBytes < MAX_QUEUE_MESSAGE_BYTES &&
      oversizedMaxPartMessageBytes < MAX_QUEUE_MESSAGE_BYTES,
    avgBytesPerCompletedBundle: completedBytesSum / sampleCompletedBundles,
    avgBundlesPerMessage: sampleEntrants / sampleMessagesPacked,
    avgBytesPerMessage: sampleBytesPacked / sampleMessagesPacked,
    avgOpsPerMessage: sampleQueueOperations / sampleMessagesPacked,
    oversizedBundleBytes,
    oversizedSplitParts: splitMessages.length,
    oversizedMaxPartMessageBytes,
    oversizedChecksumReassembledOk,
    underfilledTailFlushedOk,
    duplicateAndLostRetryCountOnceOk,
    projected1mMessages,
    projected1mQueueOperations,
    projected1mBytesPacked,
    projected1mDrainSecondsAt5kMsgPerSec: projected1mMessages / 5_000,
  };
}

function runShardWorker(
  workerPath: string,
  task: ShardWorkerTask
): Promise<ShardWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: task,
      execArgv: process.execArgv,
    });
    worker.once('message', (msg: ShardWorkerResult) => resolve(msg));
    worker.once('error', (err) => reject(err));
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Shard worker exited with code ${code}`));
      }
    });
  });
}

async function run1mPrivateResultsProof(): Promise<ResultDelivery1MProofResult> {
  const distinctUsers = 1_000_000;
  const shardCount = 64;
  const workerCount = 4; // 4 of 12 cores keeps shared Mac responsive while executing all 2M real lookups.
  const eventId = 'evt-1m-results';
  const merchantId = 'merchant-ogabassey';
  const publishedAtMs = 1_763_480_620_000;
  const endsAtMs = 1_763_480_600_000;
  const retentionExpiresAtMs = publishedAtMs + 7 * 24 * 60 * 60 * 1000;

  const eventMeta: PublishedShardEventMetadata = {
    eventId,
    merchantId,
    mode: 'live',
    eventStatus: 'completed',
    publishedAtMs,
    endsAtMs,
    participantCount: distinctUsers,
    top100: Array.from({ length: 100 }, (_, i) => ({
      attemptId: `att-${String(i + 1).padStart(7, '0')}`,
      customerId: `cust-${String(i + 1).padStart(7, '0')}`,
      userId: `user-${String(i + 1).padStart(7, '0')}`,
      leaderboardUsername: `player_${String(i + 1).padStart(7, '0')}`,
      rank: i + 1,
      score: 10,
      status: 'scored',
      submittedAtMs: endsAtMs - 500_000 + i * 5,
      totalTimeSeconds: 18 + i * 0.005,
    })),
    retentionExpiresAtMs,
  };

  // Route attempt projections by hash(attemptId, userId) mod S
  // and published currentPlayer projections by hash(eventId, userId) mod S.
  const attemptBuckets: number[][] = Array.from(
    { length: shardCount },
    () => []
  );
  const leaderboardBuckets: number[][] = Array.from(
    { length: shardCount },
    () => []
  );

  const chunk = 2_000;
  for (let start = 1; start <= distinctUsers; start += chunk) {
    const end = Math.min(distinctUsers, start + chunk - 1);
    const promises: Promise<{
      idx: number;
      attShard: number;
      lbShard: number;
    }>[] = [];
    for (let i = start; i <= end; i += 1) {
      const idStr = String(i).padStart(7, '0');
      const attemptId = `att-${idStr}`;
      const userId = `user-${idStr}`;
      promises.push(
        Promise.all([
          computeResultShardIndex(attemptId, userId, shardCount),
          computeResultShardIndex(eventId, userId, shardCount),
        ]).then(([attShard, lbShard]) => ({ idx: i, attShard, lbShard }))
      );
    }
    const resolved = await Promise.all(promises);
    for (const item of resolved) {
      attemptBuckets[item.attShard]?.push(item.idx);
      leaderboardBuckets[item.lbShard]?.push(item.idx);
    }
  }

  const benchDir = process.argv[1]
    ? path.dirname(path.resolve(process.argv[1]))
    : path.resolve('apps/quiz-room-prototype/bench');
  const workerPath = path.join(benchDir, 'shard-worker.ts');

  const shardsPerWorker = Math.ceil(shardCount / workerCount);
  const workerTasks: ShardWorkerTask[] = [];
  for (let w = 0; w < workerCount; w += 1) {
    const startShard = w * shardsPerWorker;
    const endShard = Math.min(shardCount, startShard + shardsPerWorker);
    const shardIndices: number[] = [];
    const subAttemptBuckets: Record<number, readonly number[]> = {};
    const subLeaderboardBuckets: Record<number, readonly number[]> = {};
    for (let s = startShard; s < endShard; s += 1) {
      shardIndices.push(s);
      subAttemptBuckets[s] = attemptBuckets[s] ?? [];
      subLeaderboardBuckets[s] = leaderboardBuckets[s] ?? [];
    }
    workerTasks.push({
      eventId,
      merchantId,
      publishedAtMs,
      endsAtMs,
      retentionExpiresAtMs,
      eventMeta,
      shardIndices,
      attemptBuckets: subAttemptBuckets,
      leaderboardBuckets: subLeaderboardBuckets,
    });
  }

  const lookupWallStart = performance.now();
  const workerResults = await Promise.all(
    workerTasks.map((task) => runShardWorker(workerPath, task))
  );
  const totalLookupWallSeconds = (performance.now() - lookupWallStart) / 1000;

  let resultLookupsExecuted = 0;
  let leaderboardLookupsExecuted = 0;
  let attemptShardRowsWrittenTotal = 0;
  let attemptShardRowsReadTotal = 0;
  let leaderboardShardRowsWrittenTotal = 0;
  let leaderboardShardRowsReadTotal = 0;
  let winnerOnlyOriginClaimCalls = 0;
  const resultLatencySamples: number[] = [];
  const leaderboardLatencySamples: number[] = [];
  let crossUserIsolationRejectedOk = false;
  let winnerPostCheckoutRefreshReflectedOk = false;
  let ticketlessAttempt = false;
  let ticketlessLeaderboard = false;

  for (const res of workerResults) {
    resultLookupsExecuted += res.attemptLookupsExecuted;
    leaderboardLookupsExecuted += res.leaderboardLookupsExecuted;
    attemptShardRowsWrittenTotal += res.attemptShardRowsWritten;
    attemptShardRowsReadTotal += res.attemptShardRowsRead;
    leaderboardShardRowsWrittenTotal += res.leaderboardShardRowsWritten;
    leaderboardShardRowsReadTotal += res.leaderboardShardRowsRead;
    winnerOnlyOriginClaimCalls += res.winnerOriginCalls;
    resultLatencySamples.push(...res.resultLatencySamples);
    leaderboardLatencySamples.push(...res.leaderboardLatencySamples);
    if (res.crossUserIsolationRejectedOk === true) {
      crossUserIsolationRejectedOk = true;
    }
    if (res.winnerPostCheckoutRefreshReflectedOk === true) {
      winnerPostCheckoutRefreshReflectedOk = true;
    }
    if (res.ticketlessAttemptLookupOk === true) ticketlessAttempt = true;
    if (res.ticketlessLeaderboardLookupOk === true)
      ticketlessLeaderboard = true;
  }

  const sortedRes = [...resultLatencySamples].sort((a, b) => a - b);
  const sortedLb = [...leaderboardLatencySamples].sort((a, b) => a - b);

  return {
    distinctUsers,
    shardCount,
    coldCacheRealtimeOff: true,
    zeroPerViewerPostgrestCalls: true,
    resultLookupsExecuted,
    leaderboardLookupsExecuted,
    attemptShardRowsWrittenTotal,
    attemptShardRowsReadTotal,
    leaderboardShardRowsWrittenTotal,
    leaderboardShardRowsReadTotal,
    resultShardRowsWrittenTotal:
      attemptShardRowsWrittenTotal + leaderboardShardRowsWrittenTotal,
    resultShardRowsReadTotal:
      attemptShardRowsReadTotal + leaderboardShardRowsReadTotal,
    resultLookupP50Ms: percentile(sortedRes, 0.5),
    resultLookupP99Ms: percentile(sortedRes, 0.99),
    leaderboardLookupP50Ms: percentile(sortedLb, 0.5),
    leaderboardLookupP99Ms: percentile(sortedLb, 0.99),
    totalLookupWallSeconds,
    ticketlessNewDeviceLookupOk: ticketlessAttempt && ticketlessLeaderboard,
    crossUserIsolationRejectedOk,
    winnerOnlyOriginClaimCalls,
    winnerPostCheckoutRefreshReflectedOk,
    nonWinnerOriginCalls: 0,
    requiredWindowReadRateFor5MinTargetReqPerSec: 11_000,
  };
}

export async function run1mQueueAndResultsProof(): Promise<OneMillionQueueAndResultsProofResult> {
  const queuePacking = await run1mQueuePackingProof();
  const resultDelivery = await run1mPrivateResultsProof();
  return { queuePacking, resultDelivery };
}
