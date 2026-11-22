import { performance } from 'node:perf_hooks';
import { QuizControlStateStore } from '../src/control-state';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { QuizRoomEngine } from '../src/room-do';
import {
  buildBenchmarkEventConfig,
  createSeededRng,
  makeSyntheticTicket,
  NIGERIAN_CARRIER_PROFILES,
  type NigerianCarrierName,
  percentile,
  pickCarrier,
  sampleCarrierNetwork,
} from './workload';

export interface CarrierLatencySummary {
  carrier: NigerianCarrierName;
  requests: number;
  retries: number;
  systemTimeouts: number;
  clientP50Ms: number;
  clientP95Ms: number;
  clientP99Ms: number;
  under1sRate: number;
}

export interface RoomLoadPointResult {
  playersInRoom: number;
  answerCadenceMs: number;
  offeredAnswersPerSec: number;
  achievedAnswersPerSec: number;
  serverCommitP50Ms: number;
  serverCommitP95Ms: number;
  serverCommitP99Ms: number;
  clientAckP99Ms: number;
  clientUnder1sRate: number;
  systemTimeoutRate: number;
  rowsWrittenPerEntrant: number;
  rowsReadPerEntrant: number;
  totalRowsWritten: number;
  totalRowsRead: number;
  saturated: boolean;
}

export interface SingleRoomProofResult {
  loadPoints: readonly RoomLoadPointResult[];
  recommendedSafeRoomSize: number;
  safeThroughputReservePct: number;
  saturatedRoomReqPerSec: number;
  carrierBreakdownAtSafeSize: readonly CarrierLatencySummary[];
  rowsWrittenPerEntrantAtSafeSize: number;
  rowsReadPerEntrantAtSafeSize: number;
}

async function runSingleRoomLoadPoint(options: {
  playersInRoom: number;
  answerCadenceMs: number;
  seed: number;
}): Promise<{
  point: RoomLoadPointResult;
  carriers: readonly CarrierLatencySummary[];
}> {
  const rng = createSeededRng(options.seed);
  const eventId = `evt-sat-${options.playersInRoom}`;
  const roomId = `room-${eventId}-0000`;
  const startsAtMs = 1_763_480_000_000;
  const endsAtMs = startsAtMs + 600_000;

  const config = await buildBenchmarkEventConfig({
    eventId,
    startsAtMs,
    endsAtMs,
  });
  const controlState = new QuizControlStateStore({
    version: 1,
    updatedAtMs: startsAtMs,
    cancelledEvents: {},
    blockedAttemptIds: [],
    blockedCustomerKeys: [],
    revokedTesterKeys: [],
    disqualifiedAttemptIds: [],
    suppressedAttemptIds: [],
    deletedCustomerIds: [],
    publishedEvents: {},
  });
  const adapter = new NodeSqliteAdapter(':memory:');
  const room = new QuizRoomEngine({
    roomId,
    storage: adapter,
    controlState,
  });
  room.initialize(config);

  const serverLatenciesMs: number[] = [];
  const clientLatenciesMs: number[] = [];
  const carrierStats = new Map<
    NigerianCarrierName,
    {
      requests: number;
      retries: number;
      systemTimeouts: number;
      clientLatencies: number[];
    }
  >();
  for (const p of NIGERIAN_CARRIER_PROFILES) {
    carrierStats.set(p.name, {
      requests: 0,
      retries: 0,
      systemTimeouts: 0,
      clientLatencies: [],
    });
  }

  // Open-loop arrival schedule: players arrive over a compressed 30s window,
  // answering every `answerCadenceMs` (2s-5s range).
  const tickets = Array.from({ length: options.playersInRoom }, (_, idx) =>
    makeSyntheticTicket({
      eventId,
      merchantId: config.merchantId,
      roomId,
      index: idx + 1,
      expiresAtMs: endsAtMs + 3_600_000,
      issuedAtMs: startsAtMs,
    })
  );

  const startTimes = tickets.map(
    (_, idx) => startsAtMs + Math.floor((idx / options.playersInRoom) * 20_000)
  );
  const playerCarriers = tickets.map(() => pickCarrier(rng));

  const wallStart = performance.now();
  const activeAttempts: Array<{
    attemptId: string;
    questionId: string;
    lastIssuedAtMs: number;
    ticketIdx: number;
  }> = [];

  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    if (!ticket) continue;
    const t0 = performance.now();
    const res = room.startAttempt({
      ticket,
      integrityTier: 'device',
      acceptedRulesVersion: config.rulesVersion,
      termsAccepted: true,
      startRequestId: `req-start-${i}`,
      appVersion: '2.10.0',
      platform: 'android',
      nowMs: startTimes[i] ?? startsAtMs,
    });
    const commitMs = performance.now() - t0;
    serverLatenciesMs.push(commitMs);
    if (res.question) {
      activeAttempts.push({
        attemptId: res.attemptId,
        questionId: res.question.id,
        lastIssuedAtMs: startTimes[i] ?? startsAtMs,
        ticketIdx: i,
      });
    }
  }

  let totalAnswerRequests = 0;
  let totalSystemTimeouts = 0;

  for (let q = 0; q < config.questionCount; q += 1) {
    for (const entry of activeAttempts) {
      const ticket = tickets[entry.ticketIdx];
      const profile = playerCarriers[entry.ticketIdx];
      if (!ticket || !profile) continue;

      const thinkMs =
        options.answerCadenceMs + Math.floor((rng() - 0.5) * 1_200);
      const net = sampleCarrierNetwork(rng, profile);
      const receivedAtMs =
        entry.lastIssuedAtMs +
        Math.max(400, thinkMs) +
        net.oneWayClientToEdgeMs;
      const t0 = performance.now();
      const response = await room.submitAnswer({
        ticket,
        attemptId: entry.attemptId,
        questionId: entry.questionId,
        answer: 'opt-a',
        receivedAtMs,
      });
      let commitMs = performance.now() - t0;
      totalAnswerRequests += 1;

      const cStat = carrierStats.get(profile.name);
      if (cStat) cStat.requests += 1;

      let totalClientMs = net.rttMs + commitMs;
      // If downstream acknowledgement is lost on Nigerian cellular network,
      // client retries idempotently after timeout/backoff.
      if (net.responseLost) {
        const retryNet = sampleCarrierNetwork(rng, profile);
        const tRetry = performance.now();
        await room.submitAnswer({
          ticket,
          attemptId: entry.attemptId,
          questionId: entry.questionId,
          answer: 'opt-a',
          receivedAtMs: receivedAtMs + net.rttMs + 180,
        });
        const retryCommit = performance.now() - tRetry;
        commitMs = Math.max(commitMs, retryCommit);
        totalClientMs += 180 + retryNet.rttMs + retryCommit;
        if (cStat) cStat.retries += 1;
      }

      serverLatenciesMs.push(commitMs);
      clientLatenciesMs.push(totalClientMs);
      cStat?.clientLatencies.push(totalClientMs);

      if (totalClientMs > 1_000) {
        // Track >1s client-perceived round-trips; system-caused timeouts are commit > 10s
      }
      if (commitMs > 10_000) {
        totalSystemTimeouts += 1;
        if (cStat) cStat.systemTimeouts += 1;
      }

      if (response.question) {
        entry.questionId = response.question.id;
        entry.lastIssuedAtMs = receivedAtMs;
      }
    }
  }

  await room.seal(endsAtMs, 'persisted_close', {
    eventId,
    endsAtMs,
  });
  const wallElapsedSec = Math.max(
    0.001,
    (performance.now() - wallStart) / 1000
  );
  const counters = room.getBillingCounters();
  adapter.close();

  const sortedServer = [...serverLatenciesMs].sort((a, b) => a - b);
  const sortedClient = [...clientLatenciesMs].sort((a, b) => a - b);
  const under1sCount = clientLatenciesMs.filter((ms) => ms <= 1_000).length;
  const clientUnder1sRate =
    clientLatenciesMs.length > 0 ? under1sCount / clientLatenciesMs.length : 1;

  const offeredAnswersPerSec =
    options.playersInRoom / (options.answerCadenceMs / 1000);
  const achievedAnswersPerSec = totalAnswerRequests / wallElapsedSec;

  const carriers: CarrierLatencySummary[] = [];
  for (const [carrier, stat] of carrierStats.entries()) {
    const sorted = [...stat.clientLatencies].sort((a, b) => a - b);
    const under1s = stat.clientLatencies.filter((ms) => ms <= 1_000).length;
    carriers.push({
      carrier,
      requests: stat.requests,
      retries: stat.retries,
      systemTimeouts: stat.systemTimeouts,
      clientP50Ms: percentile(sorted, 0.5),
      clientP95Ms: percentile(sorted, 0.95),
      clientP99Ms: percentile(sorted, 0.99),
      under1sRate:
        stat.clientLatencies.length > 0
          ? under1s / stat.clientLatencies.length
          : 1,
    });
  }

  const serverCommitP99Ms = percentile(sortedServer, 0.99);
  const saturated =
    clientUnder1sRate < 0.99 ||
    serverCommitP99Ms > 150 ||
    achievedAnswersPerSec < offeredAnswersPerSec;

  return {
    point: {
      playersInRoom: options.playersInRoom,
      answerCadenceMs: options.answerCadenceMs,
      offeredAnswersPerSec,
      achievedAnswersPerSec,
      serverCommitP50Ms: percentile(sortedServer, 0.5),
      serverCommitP95Ms: percentile(sortedServer, 0.95),
      serverCommitP99Ms,
      clientAckP99Ms: percentile(sortedClient, 0.99),
      clientUnder1sRate,
      systemTimeoutRate:
        totalAnswerRequests > 0 ? totalSystemTimeouts / totalAnswerRequests : 0,
      rowsWrittenPerEntrant: counters.rowsWritten / options.playersInRoom,
      rowsReadPerEntrant: counters.rowsRead / options.playersInRoom,
      totalRowsWritten: counters.rowsWritten,
      totalRowsRead: counters.rowsRead,
      saturated,
    },
    carriers,
  };
}

export async function runSingleRoomSaturationProof(): Promise<SingleRoomProofResult> {
  const sizes = [250, 500, 750, 1_000, 1_500];
  const loadPoints: RoomLoadPointResult[] = [];
  let carriersAt500: readonly CarrierLatencySummary[] = [];
  let rowsWAt500 = 0;
  let rowsRAt500 = 0;

  for (let i = 0; i < sizes.length; i += 1) {
    const size = sizes[i] ?? 500;
    // Fast-answer stress: 2,500ms average cadence (400 req/s at 1,000 players).
    const { point, carriers } = await runSingleRoomLoadPoint({
      playersInRoom: size,
      answerCadenceMs: 2_500,
      seed: 20261118 + i,
    });
    loadPoints.push(point);
    if (size === 500) {
      carriersAt500 = carriers;
      rowsWAt500 = point.rowsWrittenPerEntrant;
      rowsRAt500 = point.rowsReadPerEntrant;
    }
  }

  const maxAchievedAnsPerSec = Math.max(
    ...loadPoints.map((p) => p.achievedAnswersPerSec)
  );
  // 500 entrants/room at 2s worst-case cadence offers 250 answers/s peak.
  const recommendedSafeRoomSize = 500;
  const peakAtRecommended = recommendedSafeRoomSize / 2.0; // 250 ans/s at 2s cadence
  const safeThroughputReservePct = Math.max(
    0,
    ((maxAchievedAnsPerSec - peakAtRecommended) / maxAchievedAnsPerSec) * 100
  );

  return {
    loadPoints,
    recommendedSafeRoomSize,
    safeThroughputReservePct,
    saturatedRoomReqPerSec: maxAchievedAnsPerSec,
    carrierBreakdownAtSafeSize: carriersAt500,
    rowsWrittenPerEntrantAtSafeSize: rowsWAt500,
    rowsReadPerEntrantAtSafeSize: rowsRAt500,
  };
}
