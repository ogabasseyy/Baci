import { describe, expect, it } from 'vitest';
import {
  computeAttemptBundleChecksumSha256,
  MAX_QUEUE_MESSAGE_BYTES,
  QuizBatchPacker,
  QuizBatchReassembler,
} from '../src/batch-packer';
import type {
  QuizAttemptBundle,
  QuizEventConfig,
  QuizRoomSealManifest,
} from '../src/contracts';
import {
  createEmptyControlState,
  QuizControlStateStore,
} from '../src/control-state';
import { EventCoordinatorEngine } from '../src/coordinator';
import { quizAnswerKeyHash } from '../src/crypto';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { QuizRoomEngine } from '../src/room-do';

async function buildConfig(endsAtMs: number): Promise<QuizEventConfig> {
  const correctHash = await quizAnswerKeyHash('opt-a');
  const slots = Array.from({ length: 10 }, (_, idx) => {
    const slotNum = idx + 1;
    const slotId = `00000000-0000-4000-8000-${String(slotNum).padStart(12, '0')}`;
    return {
      id: slotId,
      slotIndex: slotNum,
      active: true,
      variants: [
        {
          id: `10000000-0000-4000-8000-${String(slotNum).padStart(12, '0')}`,
          slotId,
          prompt: `Q${slotNum}?`,
          options: [
            { id: 'opt-a', label: 'A' },
            { id: 'opt-b', label: 'B' },
          ],
          answerKeyHash: correctHash,
          active: true,
        },
      ],
    };
  });

  return {
    eventId: 'evt-closure-001',
    merchantId: 'merch-ogabassey',
    mode: 'live',
    contractVersion: 2,
    rulesVersion: 'live-v1',
    questionCount: 10,
    timePerQuestionSeconds: 10,
    maxAttempts: 1,
    startsAtMs: endsAtMs - 120_000,
    endsAtMs,
    status: 'active',
    slots,
  };
}

describe('BatchPacker (<64KB split/duplicate/underfilled) and Coordinator room closure', () => {
  it('packs < 64,000 byte messages, flushes underfilled tail, deduplicates, and deterministically splits oversized transcripts', async () => {
    const packer = new QuizBatchPacker({
      eventId: 'evt-pack-1',
      roomId: 'room-pack-1',
    });
    const reassembler = new QuizBatchReassembler();

    const makeBundle = async (
      attemptId: string,
      answerPaddingBytes = 0
    ): Promise<QuizAttemptBundle> => {
      const answers = Array.from({ length: 10 }, (_, i) => ({
        questionId: `q-${i + 1}`,
        slotId: `s-${i + 1}`,
        position: i + 1,
        variantId: `v-${i + 1}`,
        optionOrder: ['opt-a', 'opt-b'],
        issuedAtMs: 1_700_000_000_000 + i * 1000,
        receivedAtMs: 1_700_000_000_500 + i * 1000,
        rawAnswer:
          answerPaddingBytes > 0
            ? `opt-a-${'x'.repeat(answerPaddingBytes)}`
            : 'opt-a',
        selectedAnswerHash: 'a'.repeat(64),
        answeredInMs: 500,
        timeout: false,
        scoreDelta: 1,
      }));
      const base: Omit<
        QuizAttemptBundle,
        'partIndex' | 'totalParts' | 'bundleChecksumSha256'
      > = {
        attemptId,
        admissionId: `adm-${attemptId}`,
        eventId: 'evt-pack-1',
        merchantId: 'merch-1',
        roomId: 'room-pack-1',
        userId: `u-${attemptId}`,
        customerId: `c-${attemptId}`,
        deviceHash: 'd'.repeat(64),
        leaderboardUsername: `User-${attemptId}`,
        attemptNumber: 1,
        rulesVersion: 'live-v1',
        integrityTier: 'strong',
        appVersion: '2.0.0',
        platform: 'ios',
        startRequestId: `req-${attemptId}`,
        startedAtMs: 1_700_000_000_000,
        submittedAtMs: 1_700_000_010_000,
        closeReason: 'completed',
        score: 10,
        answers,
      };
      return {
        ...base,
        partIndex: 0,
        totalParts: 1,
        bundleChecksumSha256: await computeAttemptBundleChecksumSha256(base),
      };
    };

    // Add 35 normal bundles -> triggers at least 1 auto-flush before >= 64,000 bytes
    const emittedNormal = [];
    for (let i = 0; i < 35; i += 1) {
      emittedNormal.push(
        ...(await packer.addBundle(await makeBundle(`norm-${i}`)))
      );
    }
    expect(emittedNormal.length).toBeGreaterThanOrEqual(1);
    for (const m of emittedNormal) {
      expect(m.byteLength).toBeLessThan(MAX_QUEUE_MESSAGE_BYTES);
      expect(m.queueOperations).toBe(3);
    }

    // Add 1 oversized bundle (~95 KB transcript across 10 answers) -> flushes buffer + splits deterministically
    const oversized = await makeBundle('oversized-1', 9_000);
    const splitOut = await packer.addBundle(oversized);
    // 1 flushed underfilled normal buffer + >= 2 split parts
    expect(splitOut.length).toBeGreaterThanOrEqual(3);
    for (const m of splitOut) {
      expect(m.byteLength).toBeLessThan(MAX_QUEUE_MESSAGE_BYTES);
    }

    // Add 1 tiny final bundle and flush underfilled tail
    await packer.addBundle(await makeBundle('tail-1'));
    const tail = await packer.flush();
    expect(tail).not.toBeNull();
    expect(tail?.message.bundleCount).toBe(1);
    expect(tail?.byteLength).toBeLessThan(MAX_QUEUE_MESSAGE_BYTES);

    const allMessages = [
      ...emittedNormal,
      ...splitOut,
      ...(tail ? [tail] : []),
    ];
    const reassembledIds: string[] = [];
    for (const m of allMessages) {
      const res = await reassembler.acceptMessage(m.message);
      for (const b of res.completedBundles) {
        reassembledIds.push(b.attemptId);
        if (b.attemptId === 'oversized-1') {
          expect(b.answers).toHaveLength(10);
          expect(b.totalParts).toBe(1);
        }
      }
      // Redelivery duplicate must be deduplicated cleanly
      const dup = await reassembler.acceptMessage(m.message);
      expect(dup.duplicateBatch).toBe(true);
      expect(dup.completedBundles).toHaveLength(0);
    }
    expect(reassembledIds).toHaveLength(37);
  });

  it('closes never-opened rooms, 0-answer attempts, and 7/10 partial attempts, enforces two-fact publication gate, and compares persistedCloseAt vs ends_at', async () => {
    const endsAtMs = 1_700_000_120_000;
    const persistedCloseAtMs = 1_700_000_121_500;
    const config = await buildConfig(endsAtMs);
    const controlState = new QuizControlStateStore(
      createEmptyControlState(endsAtMs - 40_000, 1)
    );

    const roomStorage1 = new NodeSqliteAdapter(':memory:');
    const roomStorage2 = new NodeSqliteAdapter(':memory:');
    const roomStorage3NeverOpened = new NodeSqliteAdapter(':memory:');

    const room1 = new QuizRoomEngine({
      roomId: 'room-1',
      storage: roomStorage1,
      controlState,
    });
    const room2 = new QuizRoomEngine({
      roomId: 'room-2',
      storage: roomStorage2,
      controlState,
    });
    const room3 = new QuizRoomEngine({
      roomId: 'room-3-never-opened',
      storage: roomStorage3NeverOpened,
      controlState,
    });

    room1.initialize(config);
    room2.initialize(config);
    // Note: room3 is intentionally NEVER opened/initialized before close!

    // Room 1: Player A finishes 10/10 at endsAtMs - 10_000 (score 7); Player B disconnects at 7/10 (score 7 -> faster than A under persistedClose? No, longer elapsed!)
    // Actually give Player B 8/10 correct (score 8!) so disconnected partial player places #1!
    const tA = {
      userId: 'u-a',
      customerId: 'c-a',
      merchantId: config.merchantId,
      eventId: config.eventId,
      roomId: 'room-1',
      deviceHash: 'a'.repeat(64),
      leaderboardUsername: 'FinisherA',
      expiresAtMs: endsAtMs + 60_000,
    };
    let sA = room1.startAttempt({
      ticket: tA,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-a',
      appVersion: '2.0.0',
      platform: 'ios',
      nowMs: endsAtMs - 30_000,
    });
    for (let q = 0; q < 10; q += 1) {
      const qA = sA.question;
      if (!qA) throw new Error('Expected qA');
      sA = await room1.submitAnswer({
        ticket: tA,
        attemptId: sA.attemptId,
        questionId: qA.id,
        answer: q < 7 ? 'opt-a' : 'opt-b',
        receivedAtMs: endsAtMs - 29_000 + q * 1_000,
        nowMs: endsAtMs - 29_000 + q * 1_000,
      });
    }

    const tB = {
      userId: 'u-b',
      customerId: 'c-b',
      merchantId: config.merchantId,
      eventId: config.eventId,
      roomId: 'room-1',
      deviceHash: 'b'.repeat(64),
      leaderboardUsername: 'PartialB',
      expiresAtMs: endsAtMs + 60_000,
    };
    let sB = room1.startAttempt({
      ticket: tB,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-b',
      appVersion: '2.0.0',
      platform: 'android',
      nowMs: endsAtMs - 15_000,
    });
    for (let q = 0; q < 7; q += 1) {
      const qB = sB.question;
      if (!qB) throw new Error('Expected qB');
      sB = await room1.submitAnswer({
        ticket: tB,
        attemptId: sB.attemptId,
        questionId: qB.id,
        answer: 'opt-a', // 7/10 correct -> tied on score 7 with A, so elapsedMs decides!
        receivedAtMs: endsAtMs - 14_500 + q * 500,
        nowMs: endsAtMs - 14_500 + q * 500,
      });
    }

    // Room 2: Player C starts with 0 answers before disconnect
    const tC = {
      userId: 'u-c',
      customerId: 'c-c',
      merchantId: config.merchantId,
      eventId: config.eventId,
      roomId: 'room-2',
      deviceHash: 'c'.repeat(64),
      leaderboardUsername: 'ZeroC',
      expiresAtMs: endsAtMs + 60_000,
    };
    room2.startAttempt({
      ticket: tC,
      integrityTier: 'basic',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-c',
      appVersion: '2.0.0',
      platform: 'web',
      nowMs: endsAtMs - 5_000,
    });

    const roomMap = new Map<string, QuizRoomEngine>([
      ['room-1', room1],
      ['room-2', room2],
      ['room-3-never-opened', room3],
    ]);

    let failRoom2Once = true;
    const coordStorage = new NodeSqliteAdapter(':memory:');
    let coordinator = new EventCoordinatorEngine({
      storage: coordStorage,
      roomClient: {
        sealRoom: async ({
          eventId,
          roomId,
          persistedCloseAtMs: closeAt,
          mode,
          endsAtMs: eEnd,
        }) => {
          if (roomId === 'room-2' && failRoom2Once) {
            failRoom2Once = false;
            throw new Error('Transient DO RPC timeout');
          }
          const target = roomMap.get(roomId);
          if (!target) throw new Error(`Missing room ${roomId}`);
          return target.seal(closeAt, mode, { eventId, endsAtMs: eEnd });
        },
      },
    });

    coordinator.freezeExpectedRooms({
      eventId: config.eventId,
      endsAtMs,
      expectedRoomIds: ['room-1', 'room-2', 'room-3-never-opened'],
    });

    // First sweep: room-2 fails transiently -> 2 of 3 sealed -> publication MUST stay blocked!
    const snap1 = await coordinator.sweepClose({
      eventId: config.eventId,
      nowMs: persistedCloseAtMs,
    });
    expect(snap1.allRoomsSealed).toBe(false);
    expect(snap1.sealedCount).toBe(2);
    expect(snap1.pendingRoomIds).toEqual(['room-2']);

    const gateWhileUnsealed = await coordinator.canPublishResults({
      eventId: config.eventId,
      completedScoringManifestChecksum: 'any',
    });
    expect(gateWhileUnsealed.allowed).toBe(false);

    // Simulate coordinator restart on same SQLite storage, then retry sweep
    coordinator = new EventCoordinatorEngine({
      storage: coordStorage,
      roomClient: {
        sealRoom: async ({
          eventId,
          roomId,
          persistedCloseAtMs: closeAt,
          mode,
          endsAtMs: eEnd,
        }) => {
          const target = roomMap.get(roomId);
          if (!target) throw new Error(`Missing room ${roomId}`);
          return target.seal(closeAt, mode, { eventId, endsAtMs: eEnd });
        },
      },
    });
    const snap2 = await coordinator.sweepClose({
      eventId: config.eventId,
      nowMs: persistedCloseAtMs + 5_000, // must preserve original persistedCloseAtMs!
    });
    expect(snap2.allRoomsSealed).toBe(true);
    expect(snap2.persistedCloseAtMs).toBe(persistedCloseAtMs);
    expect(snap2.totalAttempts).toBe(3); // A, B, C; never-opened room-3 had 0
    expect(snap2.totalAnswers).toBe(17); // 10 + 7 + 0

    // Never-opened room-3 has durable empty seal manifest
    const m3 = room3.getSealManifest() as QuizRoomSealManifest;
    expect(m3.attemptCount).toBe(0);
    expect(m3.batchCount).toBe(0);

    // Interrupted scoring (mismatched / null checksum) still blocks publication
    const gateBeforeScoring = await coordinator.canPublishResults({
      eventId: config.eventId,
      completedScoringManifestChecksum: null,
    });
    expect(gateBeforeScoring.allowed).toBe(false);

    const gateAfterScoring = await coordinator.canPublishResults({
      eventId: config.eventId,
      completedScoringManifestChecksum: snap2.manifestChecksumSha256,
    });
    expect(gateAfterScoring.allowed).toBe(true);

    // Verify missing-batch replay from room1's durable journal
    const m1 = room1.getSealManifest();
    const m1BatchId = m1?.batchIds[0];
    if (!m1BatchId) throw new Error('Expected room1 batchId');
    const replayedBatch = room1.getJournalBatch(m1BatchId);
    expect(replayedBatch?.bundles.length).toBe(2);
    const partialBundle = replayedBatch?.bundles.find(
      (b) => b.customerId === 'c-b'
    );
    const finishedBundle = replayedBatch?.bundles.find(
      (b) => b.customerId === 'c-a'
    );
    if (!partialBundle || !finishedBundle) {
      throw new Error('Expected partial and finished bundles');
    }
    expect(finishedBundle.submittedAtMs).toBe(endsAtMs - 20_000); // preserved original submission time
    expect(partialBundle.submittedAtMs).toBe(persistedCloseAtMs); // stamped with persistedCloseAtMs

    // Also verify fairness replay comparison with scheduled_ends_at mode on a fresh clone room
    const replayStorage = new NodeSqliteAdapter(':memory:');
    const replayRoom = new QuizRoomEngine({
      roomId: 'room-replay',
      storage: replayStorage,
      controlState,
    });
    replayRoom.initialize(config);
    const tReplay = { ...tB, roomId: 'room-replay' };
    const sReplay = replayRoom.startAttempt({
      ticket: tReplay,
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-b-replay',
      appVersion: '2.0.0',
      platform: 'android',
      nowMs: endsAtMs - 15_000,
    });
    expect(sReplay.status).toBe('in_progress');
    const replayManifest = await replayRoom.seal(
      persistedCloseAtMs,
      'scheduled_ends_at'
    );
    const replayBatchId = replayManifest.batchIds[0];
    if (!replayBatchId) throw new Error('Expected replayBatchId');
    const replayBatch = replayRoom.getJournalBatch(replayBatchId);
    // In scheduled_ends_at mode, open attempt is stamped with endsAtMs (15,000ms elapsed vs 16,500ms)
    expect(replayBatch?.bundles[0]?.submittedAtMs).toBe(endsAtMs);

    // Also verify cancelled event flow produces event_cancelled seals & 0 awards
    const cancelStorage = new NodeSqliteAdapter(':memory:');
    const cancelRoom = new QuizRoomEngine({
      roomId: 'room-cancel',
      storage: cancelStorage,
      controlState,
    });
    cancelRoom.initialize(config);
    cancelRoom.startAttempt({
      ticket: { ...tB, roomId: 'room-cancel' },
      integrityTier: 'strong',
      acceptedRulesVersion: 'live-v1',
      termsAccepted: true,
      startRequestId: 'req-cancel-1',
      appVersion: '2.0.0',
      platform: 'android',
      nowMs: endsAtMs - 15_000,
    });
    const cancelCoordStorage = new NodeSqliteAdapter(':memory:');
    const cancelCoord = new EventCoordinatorEngine({
      storage: cancelCoordStorage,
      roomClient: {
        sealRoom: ({
          eventId,
          persistedCloseAtMs: closeAt,
          mode,
          endsAtMs: eEnd,
        }) => cancelRoom.seal(closeAt, mode, { eventId, endsAtMs: eEnd }),
      },
    });
    cancelCoord.freezeExpectedRooms({
      eventId: config.eventId,
      endsAtMs,
      expectedRoomIds: ['room-cancel'],
    });
    const cancelSnap = await cancelCoord.sweepClose({
      eventId: config.eventId,
      nowMs: endsAtMs - 5_000,
      mode: 'cancelled',
    });
    expect(cancelSnap.allRoomsSealed).toBe(true);
    expect(cancelSnap.sealMode).toBe('cancelled');
    const cancelManifest = cancelRoom.getSealManifest();
    expect(cancelManifest?.eventStatus).toBe('cancelled');
    const cancelBatch = cancelRoom.getJournalBatch(
      cancelManifest?.batchIds[0] ?? ''
    );
    expect(cancelBatch?.bundles[0]?.closeReason).toBe('event_cancelled');

    roomStorage1.close();
    roomStorage2.close();
    roomStorage3NeverOpened.close();
    coordStorage.close();
    replayStorage.close();
    cancelStorage.close();
    cancelCoordStorage.close();
  });

  it('produces identical ranks and checksums whether alarm fires before coordinator or coordinator sweeps before alarm', async () => {
    const endsAtMs = 1_700_000_120_000;
    const persistedCloseAtMs = endsAtMs + 1_250;
    const config = await buildConfig(endsAtMs);
    const controlState = new QuizControlStateStore(
      createEmptyControlState(endsAtMs - 40_000, 1)
    );

    const runScenario = async (order: 'alarm-first' | 'coordinator-first') => {
      const sRoom = new NodeSqliteAdapter(':memory:');
      const sCoord = new NodeSqliteAdapter(':memory:');
      const room = new QuizRoomEngine({
        roomId: 'room-race',
        storage: sRoom,
        controlState,
      });
      room.initialize(config);

      // 1 finished player + 1 partial 5/10 player
      const t1 = {
        userId: 'u-r1',
        customerId: 'c-r1',
        merchantId: config.merchantId,
        eventId: config.eventId,
        roomId: 'room-race',
        deviceHash: '1'.repeat(64),
        leaderboardUsername: 'FinisherR1',
        expiresAtMs: endsAtMs + 60_000,
      };
      let st1 = room.startAttempt({
        ticket: t1,
        integrityTier: 'strong',
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        startRequestId: 'req-r1',
        appVersion: '2.0.0',
        platform: 'ios',
        nowMs: endsAtMs - 30_000,
      });
      for (let q = 0; q < 10; q += 1) {
        st1 = await room.submitAnswer({
          ticket: t1,
          attemptId: st1.attemptId,
          questionId: st1.question?.id ?? '',
          answer: 'opt-a',
          receivedAtMs: endsAtMs - 29_000 + q * 500,
          nowMs: endsAtMs - 29_000 + q * 500,
        });
      }

      const t2 = {
        userId: 'u-r2',
        customerId: 'c-r2',
        merchantId: config.merchantId,
        eventId: config.eventId,
        roomId: 'room-race',
        deviceHash: '2'.repeat(64),
        leaderboardUsername: 'PartialR2',
        expiresAtMs: endsAtMs + 60_000,
      };
      let st2 = room.startAttempt({
        ticket: t2,
        integrityTier: 'strong',
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        startRequestId: 'req-r2',
        appVersion: '2.0.0',
        platform: 'android',
        nowMs: endsAtMs - 20_000,
      });
      for (let q = 0; q < 5; q += 1) {
        st2 = await room.submitAnswer({
          ticket: t2,
          attemptId: st2.attemptId,
          questionId: st2.question?.id ?? '',
          answer: 'opt-a',
          receivedAtMs: endsAtMs - 19_000 + q * 500,
          nowMs: endsAtMs - 19_000 + q * 500,
        });
      }

      const coord = new EventCoordinatorEngine({
        storage: sCoord,
        roomClient: {
          sealRoom: ({
            eventId,
            persistedCloseAtMs: cMs,
            mode,
            endsAtMs: eEnd,
          }) => room.seal(cMs, mode, { eventId, endsAtMs: eEnd }),
        },
      });
      coord.freezeExpectedRooms({
        eventId: config.eventId,
        endsAtMs,
        expectedRoomIds: ['room-race'],
      });

      if (order === 'alarm-first') {
        const alarmRes = await room.onAlarm(endsAtMs);
        expect(alarmRes.sealed).toBe(false);
        expect(alarmRes.intakeStopped).toBe(true);
        // Late submitAnswer arriving between endsAtMs and coordinator.sweepClose must
        // NOT stamp nowMs; seal() must stamp persistedCloseAtMs uniformly!
        const lateAns = await room.submitAnswer({
          ticket: t2,
          attemptId: st2.attemptId,
          questionId: st2.question?.id ?? '',
          answer: 'opt-a',
          receivedAtMs: endsAtMs + 250,
          nowMs: endsAtMs + 250,
        });
        expect(lateAns.status).toBe('submitted_pending_results');
        expect(lateAns.submittedAt).toBeNull();
        await coord.sweepClose({
          eventId: config.eventId,
          nowMs: persistedCloseAtMs,
        });
      } else {
        await coord.sweepClose({
          eventId: config.eventId,
          nowMs: persistedCloseAtMs,
        });
        await room.onAlarm(endsAtMs + 2_000);
      }

      const snap = await coord.getSnapshot(config.eventId);
      const seal = room.getSealManifest();
      const bundles = (seal?.batchIds ?? []).flatMap(
        (id) => room.getJournalBatch(id)?.bundles ?? []
      );
      sRoom.close();
      sCoord.close();
      return { snap, seal, bundles };
    };

    const alarmFirst = await runScenario('alarm-first');
    const coordFirst = await runScenario('coordinator-first');

    expect(alarmFirst.seal?.roomChecksumSha256).toBe(
      coordFirst.seal?.roomChecksumSha256
    );
    expect(alarmFirst.snap.manifestChecksumSha256).toBe(
      coordFirst.snap.manifestChecksumSha256
    );
    expect(
      alarmFirst.bundles.map((b) => [b.attemptId, b.score, b.submittedAtMs])
    ).toEqual(
      coordFirst.bundles.map((b) => [b.attemptId, b.score, b.submittedAtMs])
    );
  });
});
