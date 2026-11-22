import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuizAdmissionTicket, QuizEventConfig } from '../src/contracts';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from '../src/control-state';
import { md5Hex, quizAnswerKeyHash } from '../src/crypto';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { QuizRoomEngine } from '../src/room-do';
import { signAdmissionTicket, verifyAdmissionTicket } from '../src/ticket';

const TICKET_SECRET = 'test-stage1-hmac-secret-2026';

async function buildEventConfig(
  overrides?: Partial<QuizEventConfig>
): Promise<QuizEventConfig> {
  const correctHash = await quizAnswerKeyHash('opt-a');
  const slots = Array.from({ length: 10 }, (_, idx) => {
    const slotNum = idx + 1;
    const slotId = `00000000-0000-4000-8000-${String(slotNum).padStart(12, '0')}`;
    return {
      id: slotId,
      slotIndex: slotNum,
      active: true,
      variants: [1, 2, 3].map((vNum) => ({
        id: `10000000-0000-4000-8000-${String(slotNum * 10 + vNum).padStart(12, '0')}`,
        slotId,
        prompt: `Question ${slotNum} variant ${vNum}?`,
        options: [
          { id: 'opt-a', label: 'Option A' },
          { id: 'opt-b', label: 'Option B' },
          { id: 'opt-c', label: 'Option C' },
          { id: 'opt-d', label: 'Option D' },
        ],
        answerKeyHash: correctHash,
        active: true,
      })),
    };
  });

  return {
    eventId: 'evt-stage1-001',
    merchantId: 'merch-ogabassey',
    mode: 'live',
    contractVersion: 2,
    rulesVersion: 'live-v1',
    questionCount: 10,
    timePerQuestionSeconds: 10,
    maxAttempts: 1,
    startsAtMs: 1_700_000_000_000,
    endsAtMs: 1_700_000_120_000,
    status: 'active',
    slots,
    retentionPeriodMs: 60_000,
    ...overrides,
  };
}

function makeTicket(
  overrides?: Partial<QuizAdmissionTicket>
): QuizAdmissionTicket {
  return {
    userId: 'user-1',
    customerId: 'cust-1',
    merchantId: 'merch-ogabassey',
    eventId: 'evt-stage1-001',
    roomId: 'room-001',
    deviceHash: 'a'.repeat(64),
    leaderboardUsername: 'AdaLovelace',
    expiresAtMs: 1_700_000_200_000,
    admissionId: 'adm-1',
    mode: 'live',
    ...overrides,
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('QuizRoomEngine gameplay, deadlines, restarts, and SQLite counters', () => {
  it('enforces HMAC admission tickets and <60s control-state freshness bound', async () => {
    const ticket = makeTicket();
    const token = await signAdmissionTicket(ticket, TICKET_SECRET);
    const verified = await verifyAdmissionTicket(token, {
      secret: TICKET_SECRET,
      nowMs: 1_700_000_010_000,
      expectedEventId: 'evt-stage1-001',
      expectedRoomId: 'room-001',
      expectedDeviceHash: ticket.deviceHash,
    });
    expect(verified.customerId).toBe('cust-1');

    // Tampered token fails
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    await expect(
      verifyAdmissionTicket(tampered, {
        secret: TICKET_SECRET,
        nowMs: 1_700_000_010_000,
      })
    ).rejects.toMatchObject({ code: 'QUIZ_TICKET_INVALID' });

    // Stale control state (>= 60,000ms) suspends new starts
    const config = await buildEventConfig();
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore(
      createEmptyControlState(1_700_000_000_000, 1)
    );
    const room = new QuizRoomEngine({
      roomId: 'room-001',
      storage,
      controlState,
    });
    room.initialize(config);

    expect(() =>
      room.startAttempt({
        ticket,
        integrityTier: 'strong',
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        startRequestId: 'req-stale-1',
        appVersion: '2.0.0',
        platform: 'ios',
        nowMs: 1_700_000_060_000, // exactly 60,000ms stale -> suspended
      })
    ).toThrowError(/stale/i);

    // Refresh control state (< 60,000ms) -> start succeeds
    controlState.applySnapshot(createEmptyControlState(1_700_000_055_000, 2));
    const started = room.startAttempt({
      ticket,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-fresh-1',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs: 1_700_000_060_000,
    });
    expect(started.status).toBe('in_progress');
    storage.close();
  });

  it('selects variants & options deterministically via md5 and never leaks answerKeyHash or correctness on wire', async () => {
    const config = await buildEventConfig();
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore(
      createEmptyControlState(1_700_000_000_000, 1)
    );
    const room = new QuizRoomEngine({
      roomId: 'room-001',
      storage,
      controlState,
    });
    room.initialize(config);

    const ticket = makeTicket();
    const started = room.startAttempt({
      ticket,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-1',
      appVersion: '2.0.0',
      platform: 'android',
      nowMs: 1_700_000_005_000,
    });

    // Verify wire payload contains zero private answer keys or correctness
    const wireJson = JSON.stringify(started);
    expect(wireJson).not.toContain('answerKeyHash');
    expect(wireJson).not.toContain('scoreDelta');
    expect(wireJson).not.toContain('isCorrect');
    expect(started.question?.index).toBe(1);
    expect(started.question?.total).toBe(10);
    expect(started.question?.issuedAt).toBe(
      new Date(1_700_000_005_000).toISOString()
    );

    // Verify option ordering matches md5(option.id + ':' + attemptId)
    const expectedOrder = ['opt-a', 'opt-b', 'opt-c', 'opt-d']
      .map((id) => ({ id, k: md5Hex(`${id}:${started.attemptId}`) }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map((x) => x.id);
    expect(started.question?.options.map((o) => o.id)).toEqual(expectedOrder);

    // Verify variant selection matches md5(variant.id + ':' + attemptId)
    const slot1 = config.slots[0];
    expect(slot1).toBeDefined();
    const expectedVariant = [...(slot1?.variants ?? [])].sort((a, b) => {
      const ka = md5Hex(`${a.id}:${started.attemptId}`);
      const kb = md5Hex(`${b.id}:${started.attemptId}`);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })[0];
    expect(started.question?.prompt).toBe(expectedVariant?.prompt);

    storage.close();
  });

  it('enforces quiz_effective_question_deadline_v2 (LEAST(issued+limit, ends_at)) and handles restarts & lost responses idempotently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-room-restart-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'room.sqlite');

    const config = await buildEventConfig({
      startsAtMs: 1_700_000_000_000,
      endsAtMs: 1_700_000_025_000, // 25s window
      timePerQuestionSeconds: 10,
    });
    const controlState = new QuizControlStateStore(
      createEmptyControlState(1_700_000_000_000, 1)
    );
    const storage = new NodeSqliteAdapter(dbPath);
    let room = new QuizRoomEngine({
      roomId: 'room-001',
      storage,
      controlState,
    });
    room.initialize(config);

    const ticket = makeTicket();
    // Start at t = +2s -> Q1 issuedAt = 1_700_000_002_000, deadline = 1_700_000_012_000
    const s1 = room.startAttempt({
      ticket,
      integrityTier: 'device',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-restart-1',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs: 1_700_000_002_000,
    });
    const q1 = s1.question;
    if (!q1) throw new Error('Expected Q1');
    expect(q1.deadlineAt).toBe(new Date(1_700_000_012_000).toISOString());

    // Answer Q1 at 1ms BEFORE deadline (receivedAtMs = deadline - 1) -> accepted as on-time!
    const afterQ1 = await room.submitAnswer({
      ticket,
      attemptId: s1.attemptId,
      questionId: q1.id,
      answer: 'opt-a',
      receivedAtMs: 1_700_000_011_999,
      nowMs: 1_700_000_012_005, // queued slightly past deadline, but receivedAtMs was on time!
    });
    expect(afterQ1.question?.index).toBe(2);
    const q2 = afterQ1.question;
    if (!q2) throw new Error('Expected Q2');

    // Simulate lost HTTP response: client retries Q1 AND Room DO restarts (reopen SQLite file)
    storage.reopen();
    controlState.applySnapshot(createEmptyControlState(1_700_000_012_010, 2));
    room = new QuizRoomEngine({
      roomId: 'room-001',
      storage,
      controlState,
    });

    const retryQ1 = await room.submitAnswer({
      ticket,
      attemptId: s1.attemptId,
      questionId: q1.id,
      answer: 'opt-b', // different answer on retry must NOT overwrite original Q1!
      receivedAtMs: 1_700_000_012_500,
      nowMs: 1_700_000_012_500,
    });
    // Still on Q2 with Q2's original issuedAt (clock NOT reset!)
    expect(retryQ1.question?.id).toBe(q2.id);
    expect(retryQ1.question?.issuedAt).toBe(q2.issuedAt);

    // Resume check also returns Q2 without resetting clock
    const resumed = room.resumeAttempt(ticket, 1_700_000_013_000);
    expect(resumed.availability).toBe('active');
    expect(resumed.attempt?.question?.id).toBe(q2.id);
    expect(resumed.attempt?.question?.issuedAt).toBe(q2.issuedAt);

    // Q2 answered at exact deadline (receivedAtMs === deadlineMs) -> late (0 points)
    // Q2 issuedAt was 1_700_000_012_005 -> normal +10s = 1_700_000_022_005 (< endsAt 025_000)
    const afterQ2 = await room.submitAnswer({
      ticket,
      attemptId: s1.attemptId,
      questionId: q2.id,
      answer: 'opt-a',
      receivedAtMs: 1_700_000_022_005,
      nowMs: 1_700_000_022_006,
    });
    const q3 = afterQ2.question;
    if (!q3) throw new Error('Expected Q3');
    // Q3 issued at 022_006, so its effective deadline MUST be clamped to event endsAtMs (025_000)!
    expect(q3.deadlineAt).toBe(new Date(1_700_000_025_000).toISOString());

    // Seal and inspect transcripts to verify Q1=1pt, Q2=0pt (late), and clocks preserved
    const manifest = await room.seal(1_700_000_025_100, 'persisted_close');
    expect(manifest.attemptCount).toBe(1);
    const firstBatchId = manifest.batchIds[0];
    if (!firstBatchId) throw new Error('Expected batchId');
    const batch = room.getJournalBatch(firstBatchId);
    const bundle = batch?.bundles[0];
    if (!bundle) throw new Error('Expected bundle');
    expect(bundle.startedAtMs).toBe(1_700_000_002_000);
    expect(bundle.submittedAtMs).toBe(1_700_000_025_100);
    expect(bundle.closeReason).toBe('event_closed');
    expect(bundle.score).toBe(1);
    expect(bundle.answers[0]?.scoreDelta).toBe(1);
    expect(bundle.answers[0]?.timeout).toBe(false);
    expect(bundle.answers[1]?.scoreDelta).toBe(0);
    expect(bundle.answers[1]?.timeout).toBe(true);

    // Guarded deleteAll() refuses before retention expires
    expect(() =>
      room.deleteAllIfRetentionExpired(1_700_000_030_000)
    ).toThrowError(/retention/i);
    room.deleteAllIfRetentionExpired(1_700_000_025_100 + 60_000);
    storage.close();
  });

  it('measures exact per-entrant SQLite rowsWritten and rowsRead for a full 10-question attempt', async () => {
    const config = await buildEventConfig();
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore(
      createEmptyControlState(1_700_000_000_000, 1)
    );
    const room = new QuizRoomEngine({
      roomId: 'room-001',
      storage,
      controlState,
    });
    room.initialize(config);
    room.resetBillingCounters();

    const entrantCount = 25;
    for (let i = 0; i < entrantCount; i += 1) {
      const ticket = makeTicket({
        userId: `user-${i}`,
        customerId: `cust-${i}`,
        deviceHash: `${String(i).padStart(2, '0')}`.repeat(32),
        leaderboardUsername: `Player${i}`,
      });
      let state = room.startAttempt({
        ticket,
        integrityTier: 'strong',
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        startRequestId: `req-${i}`,
        appVersion: '2.0.0',
        platform: 'android',
        nowMs: 1_700_000_001_000 + i * 10,
      });
      for (let q = 0; q < 10; q += 1) {
        const question = state.question;
        if (!question) throw new Error('Expected question');
        state = await room.submitAnswer({
          ticket,
          attemptId: state.attemptId,
          questionId: question.id,
          answer: 'opt-a',
          receivedAtMs: 1_700_000_001_500 + i * 10 + q * 500,
          nowMs: 1_700_000_001_500 + i * 10 + q * 500,
        });
      }
      expect(state.status).toBe('submitted_pending_results');
    }

    const batches = await room.flushPendingBatches(1_700_000_010_000);
    const counters = room.getBillingCounters();
    const writesPerEntrant = counters.rowsWritten / entrantCount;
    const readsPerEntrant = counters.rowsRead / entrantCount;

    // Must stay well within the plan's 40 rowsWritten / 50 rowsRead per-entrant envelope
    expect(writesPerEntrant).toBeGreaterThan(20);
    expect(writesPerEntrant).toBeLessThanOrEqual(40);
    expect(readsPerEntrant).toBeGreaterThan(15);
    expect(readsPerEntrant).toBeLessThanOrEqual(50);
    expect(batches.length).toBe(counters.queueMessages);
    expect(counters.queueMessages).toBeGreaterThanOrEqual(1);
    expect(counters.queueOperations).toBe(counters.queueMessages * 3);
    for (const b of batches) {
      expect(b.byteLength).toBeLessThan(64_000);
    }
    storage.close();
  });

  it('handles single chained alarm (MIN(scoreboard_tick, flush_tick, ends_at)) and sub-ms/same-ms ties deterministically', async () => {
    const startsAtMs = 1_700_000_000_000;
    const endsAtMs = startsAtMs + 20_000;
    const config = await buildEventConfig({
      startsAtMs,
      endsAtMs,
      scoreboardTickMs: 2_000,
      flushTickMs: 1_000,
      retentionPeriodMs: 30_000,
    });
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore(
      createEmptyControlState(startsAtMs, 1)
    );
    const publishedBatchIds: string[] = [];
    const tickSubmissions: number[] = [];

    const room = new QuizRoomEngine({
      roomId: 'room-alarm-ties',
      storage,
      controlState,
      hooks: {
        onPublishBatches: (msgs) => {
          for (const m of msgs) publishedBatchIds.push(m.message.batchId);
        },
        onScoreboardTick: (tick) => {
          tickSubmissions.push(tick.submissions.length);
        },
      },
    });
    room.initialize(config);
    expect(room.getNextAlarmMs()).toBe(endsAtMs);

    // Two players finish with sub-ms / same-ms elapsedMs ties
    const t1 = makeTicket({
      userId: 'u-tie-1',
      customerId: 'c-tie-1',
      roomId: 'room-alarm-ties',
      deviceHash: '1'.repeat(64),
    });
    const t2 = makeTicket({
      userId: 'u-tie-2',
      customerId: 'c-tie-2',
      roomId: 'room-alarm-ties',
      deviceHash: '2'.repeat(64),
    });

    let s1 = room.startAttempt({
      ticket: t1,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-tie-1',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs: startsAtMs + 1_000,
    });
    // Demand-driven alarm stays at endsAtMs while zero attempts are submitted
    expect(room.getNextAlarmMs()).toBe(endsAtMs);

    let s2 = room.startAttempt({
      ticket: t2,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-tie-2',
      appVersion: '2.0.0',
      platform: 'android',
      nowMs: startsAtMs + 1_001, // 1ms later start
    });

    for (let q = 0; q < 10; q += 1) {
      const q1 = s1.question;
      const q2 = s2.question;
      if (!q1 || !q2) throw new Error('Expected questions');
      const tAns1 = startsAtMs + 1_100 + q * 100;
      const tAns2 = startsAtMs + 1_101 + q * 100;
      s1 = await room.submitAnswer({
        ticket: t1,
        attemptId: s1.attemptId,
        questionId: q1.id,
        answer: 'opt-a',
        receivedAtMs: tAns1,
        nowMs: tAns1,
      });
      s2 = await room.submitAnswer({
        ticket: t2,
        attemptId: s2.attemptId,
        questionId: q2.id,
        answer: 'opt-a',
        receivedAtMs: tAns2,
        nowMs: tAns2,
      });
    }

    // Completing Q10 at startsAtMs+2000 armed flushTick (+3000) and scoreboardTick (+4000)
    expect(room.getNextAlarmMs()).toBe(startsAtMs + 3_000);

    // Fire alarm at startsAtMs + 4_000 -> flushes batches, delivers 2 submissions ONCE, and returns alarm to endsAtMs
    const alarm1 = await room.onAlarm(startsAtMs + 4_000);
    expect(alarm1.flushedBatches).toBeGreaterThanOrEqual(1);
    expect(alarm1.scoreboardTicked).toBe(true);
    expect(publishedBatchIds.length).toBeGreaterThanOrEqual(1);
    expect(tickSubmissions).toEqual([2]);
    expect(room.getNextAlarmMs()).toBe(endsAtMs);

    // Subsequent idle tick at startsAtMs + 6_000 does NOT re-emit already-delivered submissions
    const alarmIdle = await room.onAlarm(startsAtMs + 6_000);
    expect(alarmIdle.scoreboardTicked).toBe(false);
    expect(tickSubmissions).toEqual([2]);

    const batch = room.getJournalBatch(publishedBatchIds[0] ?? '');
    const b1 = batch?.bundles.find((b) => b.customerId === 'c-tie-1');
    const b2 = batch?.bundles.find((b) => b.customerId === 'c-tie-2');
    expect(b1 && b2).toBeTruthy();
    if (b1 && b2) {
      expect(b1.submittedAtMs - b1.startedAtMs).toBe(
        b2.submittedAtMs - b2.startedAtMs
      );
      expect(b2.submittedAtMs - b1.submittedAtMs).toBe(1);
    }

    // Fire alarm at endsAtMs -> stops intake & flushes, does NOT seal (only Coordinator seals!)
    const alarm2 = await room.onAlarm(endsAtMs);
    expect(alarm2.sealed).toBe(false);
    expect(alarm2.intakeStopped).toBe(true);
    expect(room.getSealManifest()).toBeNull();

    // Coordinator supplies persistedCloseAtMs to seal() and chains retention alarm
    const persistedCloseAtMs = endsAtMs + 420;
    const manifest = await room.seal(persistedCloseAtMs, 'persisted_close');
    expect(manifest.persistedCloseAtMs).toBe(persistedCloseAtMs);
    expect(room.getNextAlarmMs()).toBe(persistedCloseAtMs + 30_000);

    // Fire alarm after retention expires -> executes deleteAll()
    const alarm3 = await room.onAlarm(persistedCloseAtMs + 30_000);
    expect(alarm3.deletedAll).toBe(true);
    storage.close();
  });

  it('seeds room_scoreboard_outbox once when upgrading an unsealed room with pre-existing submitted attempts', async () => {
    const startsAtMs = 1_790_100_000_000;
    const endsAtMs = startsAtMs + 60_000;
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore();
    controlState.applySnapshot(createEmptyControlState(startsAtMs, 1));

    const preUpgradeRoom = new QuizRoomEngine({
      roomId: 'room-upgrade-seed',
      storage,
      controlState,
    });
    const baseCfg = await buildEventConfig({ startsAtMs, endsAtMs });
    preUpgradeRoom.initialize({
      ...baseCfg,
      questionCount: 1,
      slots: baseCfg.slots.slice(0, 1),
    });
    const ticket = makeTicket({
      userId: 'u-upg-1',
      customerId: 'c-upg-1',
      roomId: 'room-upgrade-seed',
    });
    const started = preUpgradeRoom.startAttempt({
      ticket,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-upg-1',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs: startsAtMs + 1_000,
    });
    await preUpgradeRoom.submitAnswer({
      ticket,
      attemptId: started.attemptId,
      questionId: started.question?.id ?? '',
      answer: 'opt-a',
      receivedAtMs: startsAtMs + 1_500,
      nowMs: startsAtMs + 1_500,
    });

    // Simulate pre-outbox room state before upgrade
    storage.exec(`DROP TABLE room_scoreboard_outbox`);
    storage.exec(
      `DELETE FROM room_meta WHERE key = 'scoreboard_outbox_seeded_v1'`
    );

    const upgradedSubmissions: string[] = [];
    const upgradedRoom = new QuizRoomEngine({
      roomId: 'room-upgrade-seed',
      storage,
      controlState,
      hooks: {
        onScoreboardTick: (tick) => {
          for (const s of tick.submissions) {
            upgradedSubmissions.push(s.attemptId);
          }
        },
      },
    });
    const tickRes = await upgradedRoom.onAlarm(startsAtMs + 4_000);
    expect(tickRes.scoreboardTicked).toBe(true);
    expect(upgradedSubmissions).toEqual([started.attemptId]);

    const secondTick = await upgradedRoom.onAlarm(startsAtMs + 6_000);
    expect(secondTick.scoreboardTicked).toBe(false);
    storage.close();
  });

  it('restores submittedAtMs to receivedAtMs when repairing a timely final answer after expiry recovery', async () => {
    const startsAtMs = 1_700_000_000_000;
    const endsAtMs = startsAtMs + 120_000;
    const storage = new NodeSqliteAdapter(':memory:');
    const controlState = new QuizControlStateStore();
    controlState.applySnapshot(createEmptyControlState(startsAtMs, 1));
    const room = new QuizRoomEngine({
      roomId: 'room-timely-final',
      storage,
      controlState,
    });
    const baseCfg = await buildEventConfig({ startsAtMs, endsAtMs });
    room.initialize({
      ...baseCfg,
      questionCount: 1,
      timePerQuestionSeconds: 10,
      slots: baseCfg.slots.slice(0, 1),
    });
    const ticket = makeTicket({
      userId: 'u-timely-1',
      customerId: 'c-timely-1',
      roomId: 'room-timely-final',
    });
    const started = room.startAttempt({
      ticket,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-timely-1',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs: startsAtMs + 1_000,
    });

    // Expiry recovery runs at deadline (startsAtMs + 11_000), marking final question timed out
    const recovered = room.resumeAttempt(ticket, startsAtMs + 11_000);
    expect(recovered.availability).toBe('pending_results');

    // Timely answer that arrived at 10_900 completes hashing at 11_050
    const repaired = await room.submitAnswer({
      ticket,
      attemptId: started.attemptId,
      questionId: started.question?.id ?? '',
      answer: 'opt-a',
      receivedAtMs: startsAtMs + 10_900,
      nowMs: startsAtMs + 11_050,
    });
    expect(repaired.status).toBe('submitted_pending_results');

    const bundles = await room.exportCompletedBundles();
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.submittedAtMs).toBe(startsAtMs + 10_900);
    expect(bundles[0]?.score).toBe(1);
    storage.close();
  });
});
