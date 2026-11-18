import { describe, expect, it } from 'vitest';
import {
  priceCloudflareUsage,
  priceSupabaseIncrementalAuthUsd,
} from './pricing-model';
import {
  adjudicateReferenceStandings,
  diffCloseTimestampRankings,
} from './sql-reference';
import {
  buildBenchmarkEventConfig,
  createSeededRng,
  makeSyntheticTicket,
} from './workload';

describe('Stage 1 benchmark helpers', () => {
  it('enforces exact millisecond tie-break ordering and persistedCloseAt vs endsAt rank diff', async () => {
    const startsAtMs = 1_763_480_000_000;
    const scheduledEndsAtMs = startsAtMs + 60_000;
    const persistedCloseAtMs = scheduledEndsAtMs + 1_500;
    const config = await buildBenchmarkEventConfig({
      eventId: 'evt-test-ref',
      startsAtMs,
      endsAtMs: persistedCloseAtMs + 5_000,
    });

    const b1 = {
      attemptId: 'att-a',
      admissionId: 'adm-a',
      eventId: config.eventId,
      merchantId: config.merchantId,
      roomId: 'room-0',
      userId: 'user-a',
      customerId: 'cust-a',
      deviceHash: 'dev-a',
      leaderboardUsername: 'alice',
      attemptNumber: 1,
      rulesVersion: config.rulesVersion,
      integrityTier: 'device' as const,
      appVersion: '2.10.0',
      platform: 'android' as const,
      startRequestId: 's-a',
      startedAtMs: startsAtMs,
      submittedAtMs: startsAtMs + 10_000,
      closeReason: 'completed' as const,
      score: 1,
      answers: [
        {
          questionId: 'q-1',
          slotId: 'slot-01',
          position: 1,
          variantId: 'slot-01-var-1',
          optionOrder: ['opt-a', 'opt-b'],
          issuedAtMs: startsAtMs,
          receivedAtMs: startsAtMs + 1_000,
          rawAnswer: 'opt-a',
          selectedAnswerHash:
            config.slots[0]?.variants[0]?.answerKeyHash ?? null,
          answeredInMs: 1_000,
          timeout: false,
          scoreDelta: 1,
        },
      ],
      partIndex: 1,
      totalParts: 1,
      bundleChecksumSha256: '0'.repeat(64),
    };

    const b2 = {
      ...b1,
      attemptId: 'att-b',
      admissionId: 'adm-b',
      userId: 'user-b',
      customerId: 'cust-b',
      leaderboardUsername: 'bob',
      startedAtMs: startsAtMs + 50_000,
      submittedAtMs: persistedCloseAtMs,
      closeReason: 'event_closed' as const,
    };

    const persisted = adjudicateReferenceStandings({
      bundles: [b1, b2],
      config,
      closeCutoffMs: persistedCloseAtMs,
      sealMode: 'persisted_close',
    });
    const scheduled = adjudicateReferenceStandings({
      bundles: [b1, b2],
      config,
      closeCutoffMs: scheduledEndsAtMs,
      sealMode: 'persisted_close',
    });

    expect(persisted.awardCount).toBe(1);
    expect(persisted.winnerAttemptId).toBe('att-a');
    expect(persisted.standings[1]?.elapsedMs).toBe(11_500);
    expect(scheduled.standings[1]?.elapsedMs).toBe(10_000);

    const diffs = diffCloseTimestampRankings(
      persisted.standings,
      scheduled.standings
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.attemptId).toBe('att-b');

    const cancelled = adjudicateReferenceStandings({
      bundles: [b1, b2],
      config,
      closeCutoffMs: persistedCloseAtMs,
      sealMode: 'cancelled',
    });
    expect(cancelled.awardCount).toBe(0);
    expect(cancelled.standings).toHaveLength(0);
  });

  it('prices Cloudflare DO duration with 1M GB-s rounding and Supabase Auth MAUs accurately', () => {
    const exhausted = priceCloudflareUsage(
      {
        entrants: 1_000_000,
        completions: 1_000_000,
        counters: {
          workerInvocations: 30_000_000,
          workerCpuMs: 150_000_000,
          roomRequests: 12_000_000,
          rowsWritten: 40_000_000,
          rowsRead: 50_000_000,
          bytesPacked: 100_000_000,
          queueMessages: 40_000,
          queueOperations: 120_000,
        },
        activeRoomHours: 2_000,
        activeShardHours: 0,
        sqliteStorageGbMonths: 0,
      },
      false
    );
    expect(exhausted.gbSecondsUsed).toBe(900_000);
    expect(exhausted.doDurationRoundedUsd).toBe(12.5);
    expect(exhausted.doRowsWrittenUsd).toBe(40);
    expect(exhausted.queuesUsd).toBeCloseTo(0.048, 6);

    expect(priceSupabaseIncrementalAuthUsd(0, 100_000)).toBe(0);
    expect(priceSupabaseIncrementalAuthUsd(0, 1_000_000)).toBeCloseTo(2_925, 2);
    expect(priceSupabaseIncrementalAuthUsd(100_000, 1_000_000)).toBeCloseTo(
      3_250,
      2
    );
  });

  it('generates deterministic tickets and seeded PRNG values', () => {
    const rngA = createSeededRng(42);
    const rngB = createSeededRng(42);
    expect(rngA()).toBe(rngB());
    const ticket = makeSyntheticTicket({
      eventId: 'evt-1',
      merchantId: 'm-1',
      roomId: 'room-0',
      index: 1,
      expiresAtMs: 1000,
      issuedAtMs: 500,
    });
    expect(ticket.userId).toBe('user-0000001');
  });
});
