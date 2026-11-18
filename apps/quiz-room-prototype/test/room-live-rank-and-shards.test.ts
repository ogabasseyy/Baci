import { describe, expect, it } from 'vitest';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from '../src/control-state';
import { quizPublicLeaderboardAlias } from '../src/crypto';
import { LiveRankIndexEngine } from '../src/live-rank';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import {
  computeResultShardIndex,
  type PublishedShardEventMetadata,
  ResultShardEngine,
} from '../src/result-shard';
import { signBearerJwt, verifyBearerJwt } from '../src/ticket';

const JWT_SECRET = 'test-stage1-jwt-secret-2026';

describe('LiveRankIndexEngine (O(ranges * versions) & worst-case ties) and ResultShardEngine', () => {
  it('maintains exact SQL-matching order across range splits with 80% tied score cohort and O(ranges * versions) writes', async () => {
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore(
      createEmptyControlState(1_700_000_000_000, 1)
    );
    const index = new LiveRankIndexEngine({
      storage,
      controlState,
      targetRangeSize: 100,
      maxRangeSize: 200,
    });

    const eventId = 'evt-ties-1';
    const merchantId = 'merch-ogabassey';
    const totalPlayers = 2_000;
    const expectedEntries: {
      attemptId: string;
      customerId: string;
      score: number;
      elapsedMs: number;
      submittedAtMs: number;
    }[] = [];

    // 80% of players tied at score = 8, including same-ms and sub-ms ties!
    for (let i = 0; i < totalPlayers; i += 1) {
      const score = i < totalPlayers * 0.8 ? 8 : i % 11;
      const elapsedMs = 15_000 + (i % 25); // heavy elapsedMs collisions too
      const submittedAtMs = 1_700_000_050_000 + (i % 10); // heavy timestamp collisions
      const attemptId = `att-${String((i * 7919) % 100_000).padStart(6, '0')}-${i}`;
      const customerId = `cust-${i}`;

      index.recordSubmission({
        eventId,
        merchantId,
        attemptId,
        customerId,
        userId: `user-${i}`,
        leaderboardUsername: `Player_${i}`,
        score,
        elapsedMs,
        submittedAtMs,
        attemptStatus: 'submitted',
      });
      expectedEntries.push({
        attemptId,
        customerId,
        score,
        elapsedMs,
        submittedAtMs,
      });
    }

    // Worse second attempt for cust-0 must NOT overwrite better attempt
    const worseRes = index.recordSubmission({
      eventId,
      merchantId,
      attemptId: 'att-worse-0',
      customerId: 'cust-0',
      userId: 'user-0',
      leaderboardUsername: 'Player_0',
      score: 1,
      elapsedMs: 90_000,
      submittedAtMs: 1_700_000_090_000,
      attemptStatus: 'submitted',
    });
    expect(worseRes.accepted).toBe(false);

    // Publish initial snapshot
    const snap1 = index.publishSnapshot(eventId, 1_700_000_100_000);
    expect(snap1.published).toBe(true);
    expect(snap1.totalRanges).toBeGreaterThanOrEqual(10);
    expect(snap1.totalEntries).toBe(totalPlayers);

    // Snapshot tick with NO new submissions MUST write 0 rows!
    const snapNoop = index.publishSnapshot(eventId, 1_700_000_102_000);
    expect(snapNoop.published).toBe(false);
    expect(snapNoop.rowsWrittenThisTick).toBe(0);

    // Single update to 1 range MUST write only 1 dirty range + 1 manifest (O(ranges), NOT O(players)!)
    index.recordSubmission({
      eventId,
      merchantId,
      attemptId: 'att-better-0',
      customerId: 'cust-0',
      userId: 'user-0',
      leaderboardUsername: 'Player_0',
      score: 10,
      elapsedMs: 1_000,
      submittedAtMs: 1_700_000_010_000,
      attemptStatus: 'submitted',
    });
    expectedEntries[0] = {
      attemptId: 'att-better-0',
      customerId: 'cust-0',
      score: 10,
      elapsedMs: 1_000,
      submittedAtMs: 1_700_000_010_000,
    };

    const snap2 = index.publishSnapshot(eventId, 1_700_000_104_000);
    expect(snap2.published).toBe(true);
    expect(snap2.dirtyRangesWritten).toBeLessThanOrEqual(2);
    expect(snap2.rowsWrittenThisTick).toBeLessThanOrEqual(5);

    // Verify exact rank order against SQL reference comparator down to attemptId
    expectedEntries.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
      if (a.submittedAtMs !== b.submittedAtMs) {
        return a.submittedAtMs - b.submittedAtMs;
      }
      return a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0;
    });

    for (const sampleIdx of [0, 1, 99, 100, 101, 500, 1599, 1999]) {
      const target = expectedEntries[sampleIdx];
      if (!target) throw new Error(`Missing target at ${sampleIdx}`);
      const pos = index.getPlayerPosition(
        eventId,
        target.customerId,
        merchantId
      );
      expect(pos?.rank).toBe(sampleIdx + 1);
      expect(pos?.entry.attemptId).toBe(target.attemptId);
    }

    // Verify <60s identity masking for deleted customer / suppressed attempt
    const maskedTarget = expectedEntries[0];
    if (!maskedTarget) throw new Error('Missing maskedTarget');
    controlState.applySnapshot({
      ...createEmptyControlState(1_700_000_105_000, 2),
      suppressedAttemptIds: [maskedTarget.attemptId],
    });
    const outsideTop100 = expectedEntries[1950];
    if (!outsideTop100) throw new Error('Missing outsideTop100');
    const board = await index.getLiveLeaderboard({
      eventId,
      merchantId,
      callerCustomerId: outsideTop100.customerId,
      callerUserId: `user-${outsideTop100.customerId.replace('cust-', '')}`,
    });
    expect(board.entries[0]?.displayName).toBe(
      await quizPublicLeaderboardAlias(eventId, maskedTarget.customerId)
    );
    expect(board.currentPlayer?.isCurrentCustomer).toBe(true);
    expect(board.currentPlayer?.rank).toBe(1951);
    expect(board.participantCount).toBe(totalPlayers);

    // Merchant isolation blocks cross-merchant caller
    await expect(
      index.getLiveLeaderboard({
        eventId,
        merchantId: 'other-merchant',
        callerCustomerId: 'cust-500',
        callerUserId: 'user-500',
      })
    ).rejects.toMatchObject({ code: 'QZ031' });

    storage.close();
  });

  it('serves ticketless returning-player result & published leaderboard from hash(eventId, userId) mod S shards with 0 origin calls for ordinary viewers and origin handoff for winners', async () => {
    const eventId = 'evt-shard-1';
    const shardCount = 16;
    const winnerUserId = 'user-winner-1';
    const loserUserId = 'user-loser-150';

    const winnerShardIdx = await computeResultShardIndex(
      eventId,
      winnerUserId,
      shardCount
    );
    const loserShardIdx = await computeResultShardIndex(
      eventId,
      loserUserId,
      shardCount
    );
    expect(winnerShardIdx).toBeGreaterThanOrEqual(0);
    expect(winnerShardIdx).toBeLessThan(shardCount);

    const publishedAtMs = 1_700_000_200_000;
    const retentionExpiresAtMs = publishedAtMs + 86_400_000;

    const eventMeta: PublishedShardEventMetadata = {
      eventId,
      merchantId: 'merch-ogabassey',
      mode: 'live',
      eventStatus: 'completed',
      publishedAtMs,
      endsAtMs: publishedAtMs - 10_000,
      participantCount: 250,
      retentionExpiresAtMs,
      top100: [
        {
          attemptId: 'att-winner-1',
          customerId: 'cust-winner-1',
          userId: winnerUserId,
          leaderboardUsername: 'WinnerOne',
          rank: 1,
          score: 10,
          status: 'scored',
          submittedAtMs: publishedAtMs - 30_000,
          totalTimeSeconds: 12.345,
        },
      ],
    };

    let checkoutCompleted = false;
    const controlState = new QuizControlStateStore(
      createEmptyControlState(publishedAtMs, 1)
    );

    const loserStorage = new NodeSqliteAdapter(':memory:');
    const loserShard = new ResultShardEngine({
      shardIndex: loserShardIdx,
      storage: loserStorage,
      controlState,
      hooks: {
        fetchWinnerAwardFromOrigin: () => {
          throw new Error(
            'Origin MUST NOT be called for ordinary non-winner reads!'
          );
        },
      },
    });
    loserShard.materializeResultsBatch(eventMeta, [
      {
        eventId,
        merchantId: 'merch-ogabassey',
        attemptId: 'att-loser-150',
        userId: loserUserId,
        customerId: 'cust-loser-150',
        leaderboardUsername: 'ReturningPlayer150',
        rank: 150,
        score: 4,
        totalQuestions: 10,
        attemptStatus: 'scored',
        submittedAtMs: publishedAtMs - 20_000,
        totalTimeSeconds: 54.321,
        hasAward: false,
        retentionExpiresAtMs,
      },
    ]);

    // Returning player authenticates with bearer JWT AFTER play ticket expired & on a NEW device
    const returningJwt = await signBearerJwt(
      {
        sub: loserUserId,
        exp: Math.floor((publishedAtMs + 3_600_000) / 1000),
      },
      JWT_SECRET
    );
    const verifiedUser = await verifyBearerJwt(`Bearer ${returningJwt}`, {
      secret: JWT_SECRET,
      nowMs: publishedAtMs + 60_000,
    });

    const ordinaryResult = await loserShard.getAttemptResult({
      attemptId: 'att-loser-150',
      callerUserId: verifiedUser.userId,
      nowMs: publishedAtMs + 60_000,
    });
    expect(ordinaryResult).toEqual({
      attemptId: 'att-loser-150',
      availability: 'final',
      availableAt: new Date(publishedAtMs).toISOString(),
      score: 4,
      rank: 150,
      totalQuestions: 10,
    });
    expect(loserShard.getOriginCallCount()).toBe(0);

    const publishedBoard = await loserShard.getPublishedLeaderboard({
      eventId,
      callerUserId: verifiedUser.userId,
      callerMerchantId: 'merch-ogabassey',
    });
    expect(publishedBoard.status).toBe('published');
    expect(publishedBoard.entries).toHaveLength(1);
    expect(publishedBoard.currentPlayer?.rank).toBe(150);
    expect(publishedBoard.currentPlayer?.isCurrentCustomer).toBe(true);
    expect(loserShard.getOriginCallCount()).toBe(0);

    // Cross-user read is blocked
    const forbiddenResult = await loserShard.getAttemptResult({
      attemptId: 'att-loser-150',
      callerUserId: winnerUserId,
      nowMs: publishedAtMs + 60_000,
    });
    expect(forbiddenResult).toEqual({
      attemptId: 'att-loser-150',
      availability: 'unavailable',
      reason: 'not_found',
    });

    // Winner shard routes hasAward=true to authenticated origin and reflects post-checkout refresh
    const winnerStorage = new NodeSqliteAdapter(':memory:');
    const winnerShard = new ResultShardEngine({
      shardIndex: winnerShardIdx,
      storage: winnerStorage,
      controlState,
      hooks: {
        fetchWinnerAwardFromOrigin: ({ attemptId }) => {
          checkoutCompleted = !checkoutCompleted ? checkoutCompleted : true;
          return Promise.resolve({
            claim: {
              awardId: '00000000-0000-4000-8000-000000000099',
              expiresAt: new Date(publishedAtMs + 86_400_000).toISOString(),
              token: checkoutCompleted
                ? 'claim-post-checkout'
                : 'claim-pre-checkout',
            },
            prizeClaim: {
              awardId: '00000000-0000-4000-8000-000000000099',
              cartPath: `/checkout?attempt=${attemptId}`,
              condition: 'new',
              productId: '00000000-0000-4000-8000-000000000100',
              variantId: null,
              voucherToken: checkoutCompleted
                ? 'voucher-claimed'
                : 'voucher-pending',
            },
          });
        },
      },
    });
    winnerShard.materializeResultsBatch(eventMeta, [
      {
        eventId,
        merchantId: 'merch-ogabassey',
        attemptId: 'att-winner-1',
        userId: winnerUserId,
        customerId: 'cust-winner-1',
        leaderboardUsername: 'WinnerOne',
        rank: 1,
        score: 10,
        totalQuestions: 10,
        attemptStatus: 'scored',
        submittedAtMs: publishedAtMs - 30_000,
        totalTimeSeconds: 12.345,
        hasAward: true,
        retentionExpiresAtMs,
      },
    ]);

    const preCheckout = await winnerShard.getAttemptResult({
      attemptId: 'att-winner-1',
      callerUserId: winnerUserId,
      nowMs: publishedAtMs + 10_000,
    });
    expect(preCheckout.availability).toBe('final');
    if (preCheckout.availability === 'final') {
      expect(preCheckout.prizeClaim?.voucherToken).toBe('voucher-pending');
    }

    checkoutCompleted = true;
    const postCheckout = await winnerShard.getAttemptResult({
      attemptId: 'att-winner-1',
      callerUserId: winnerUserId,
      nowMs: publishedAtMs + 20_000,
    });
    if (postCheckout.availability === 'final') {
      expect(postCheckout.prizeClaim?.voucherToken).toBe('voucher-claimed');
    }
    expect(winnerShard.getOriginCallCount()).toBe(2);

    // Retention guard on shard deleteAll()
    expect(() =>
      loserShard.deleteAllIfRetentionExpired(publishedAtMs + 1_000)
    ).toThrowError(/retention/i);
    loserShard.deleteAllIfRetentionExpired(retentionExpiresAtMs);

    loserStorage.close();
    winnerStorage.close();
  });
});
