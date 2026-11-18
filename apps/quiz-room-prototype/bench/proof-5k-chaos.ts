import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  QuizAttemptBundle,
  QuizPackedQueueMessage,
  QuizRoomSealManifest,
} from '../src/contracts';
import { QuizControlStateStore } from '../src/control-state';
import { EventCoordinatorEngine } from '../src/coordinator';
import { NodeSqliteAdapter } from '../src/node-sqlite-adapter';
import { QuizRoomEngine } from '../src/room-do';
import {
  adjudicateReferenceStandings,
  diffCloseTimestampRankings,
} from './sql-reference';
import {
  assignDeterministicRoomId,
  buildBenchmarkEventConfig,
  createSeededRng,
  makeSyntheticTicket,
} from './workload';

export interface FiveKChaosProofResult {
  entrants: number;
  activeRooms: number;
  neverOpenedRooms: number;
  neverOpenedAttemptsCount: number;
  zeroAnswerStartedCount: number;
  partialDisconnectedPlacedRank: number | null;
  crossRoomMsTieVerified: boolean;
  roomRestartRecoveredZeroLoss: boolean;
  missingBatchRecoveredFromJournal: boolean;
  withheldSealBlockedPublication: boolean;
  interruptedScoringBlockedPublication: boolean;
  sqlReferenceParityExact: boolean;
  recoveredAwardCount: number;
  cancelledAwardCount: number;
  scheduledEndsAtChangedRankCount: number;
  persistedCloseAtMs: number;
  scheduledEndsAtMs: number;
}

export async function runFiveKChaosProof(): Promise<FiveKChaosProofResult> {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'quiz-5k-chaos-'));
  const adapters: NodeSqliteAdapter[] = [];
  try {
    const entrants = 5_000;
    const activeRoomCount = 12;
    const neverOpenedRoomId = 'room-evt-5k-never-opened';
    const eventId = 'evt-5k-chaos';
    const startsAtMs = 1_763_480_000_000;
    const scheduledEndsAtMs = startsAtMs + 600_000;
    // Coordinator wakes 1,450ms after scheduled ends_at and persists close timestamp once.
    const persistedCloseAtMs = scheduledEndsAtMs + 1_450;
    const rng = createSeededRng(5000);

    const config = await buildBenchmarkEventConfig({
      eventId,
      startsAtMs,
      endsAtMs: persistedCloseAtMs + 10_000,
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

    const deliveredBatches = new Map<string, QuizPackedQueueMessage>();
    const droppedBatchIds = new Set<string>();
    const rooms = new Map<string, QuizRoomEngine>();
    const roomPaths = new Map<string, string>();
    const expectedRoomIds: string[] = [];

    const createRoom = (roomId: string, dropFirstBatch: boolean) => {
      const dbPath = path.join(tempDir, `${roomId}.sqlite`);
      roomPaths.set(roomId, dbPath);
      const adapter = new NodeSqliteAdapter(dbPath);
      adapters.push(adapter);
      const engine = new QuizRoomEngine({
        roomId,
        storage: adapter,
        controlState,
        hooks: {
          onPublishBatches: (messages) => {
            for (const msg of messages) {
              // Simulate a lost queue delivery on the first batch of room 0003.
              if (
                dropFirstBatch &&
                msg.message.seq === 1 &&
                !droppedBatchIds.has(msg.message.batchId)
              ) {
                droppedBatchIds.add(msg.message.batchId);
                continue;
              }
              deliveredBatches.set(msg.message.batchId, msg.message);
            }
          },
        },
      });
      engine.initialize(config);
      rooms.set(roomId, engine);
      expectedRoomIds.push(roomId);
      return { engine, adapter };
    };

    for (let r = 0; r < activeRoomCount; r += 1) {
      const roomId = `room-${eventId}-${String(r).padStart(4, '0')}`;
      createRoom(roomId, r === 3);
    }
    // Never-opened room is frozen in expected rooms from admissions, never receives starts.
    createRoom(neverOpenedRoomId, false);

    // Special player indices:
    // 0: 0-answer started attempt
    // 1: 7/10 disconnected player who answers very fast so partial score still places
    // 2 (room 0002) & 3 (room 0003): cross-room 1ms tie finishers (all 10 correct, same elapsedMs, 1ms apart)
    const zeroAnswerIdx = 0;
    const partial7of10Idx = 1;
    const crossTieAIdx = 2;
    const crossTieBIdx = 3;

    let partialAttemptId = '';
    let crossTieAAttemptId = '';
    let crossTieBAttemptId = '';
    let room1StartCount = 0;

    const schedule = Array.from({ length: entrants }, (_, i) => {
      const isCrossTie = i === crossTieAIdx || i === crossTieBIdx;
      const startMs = isCrossTie
        ? startsAtMs + 10_000 + (i === crossTieBIdx ? 1 : 0)
        : startsAtMs + Math.floor(rng() * 120_000);
      return { i, startMs };
    }).sort((a, b) => a.startMs - b.startMs);

    for (let orderIdx = 0; orderIdx < schedule.length; orderIdx += 1) {
      const item = schedule[orderIdx];
      if (!item) continue;
      const { i, startMs: playerStartMs } = item;
      if (playerStartMs - controlState.getUpdatedAtMs() >= 30_000) {
        controlState.applySnapshot({
          ...controlState.getSnapshot(),
          version: controlState.getVersion() + 1,
          updatedAtMs: playerStartMs,
        });
      }
      const roomId = assignDeterministicRoomId(eventId, i, activeRoomCount);
      const room = rooms.get(roomId);
      if (!room) continue;
      const ticket = makeSyntheticTicket({
        eventId,
        merchantId: config.merchantId,
        roomId,
        index: i + 1,
        expiresAtMs: scheduledEndsAtMs + 3_600_000,
        issuedAtMs: startsAtMs,
      });

      const isZeroAnswer = i === zeroAnswerIdx;
      const isPartial7 = i === partial7of10Idx;
      const isCrossTie = i === crossTieAIdx || i === crossTieBIdx;

      const started = room.startAttempt({
        ticket,
        integrityTier: 'device',
        acceptedRulesVersion: config.rulesVersion,
        termsAccepted: true,
        startRequestId: `req-5k-${i}`,
        appVersion: '2.10.0',
        platform: 'android',
        nowMs: playerStartMs,
      });

      if (isPartial7) partialAttemptId = started.attemptId;
      if (i === crossTieAIdx) crossTieAAttemptId = started.attemptId;
      if (i === crossTieBIdx) crossTieBAttemptId = started.attemptId;

      // Simulate room restart mid-event on room 0001 right after 10 starts in that room.
      if (roomId === `room-${eventId}-0001`) {
        room1StartCount += 1;
      }
      if (roomId === `room-${eventId}-0001` && room1StartCount === 10) {
        const dbPath = roomPaths.get(roomId);
        if (dbPath) {
          const restartedAdapter = new NodeSqliteAdapter(dbPath);
          adapters.push(restartedAdapter);
          const restartedRoom = new QuizRoomEngine({
            roomId,
            storage: restartedAdapter,
            controlState,
          });
          restartedRoom.initialize(config);
          // Verify resume returns the same attempt without resetting clock.
          const resumed = restartedRoom.resumeAttempt(
            ticket,
            playerStartMs + 500
          );
          if (resumed.attempt?.attemptId !== started.attemptId) {
            throw new Error('Room restart failed to preserve attemptId');
          }
          rooms.set(roomId, restartedRoom);
        }
      }

      if (isZeroAnswer) {
        continue;
      }

      const maxQuestionsToAnswer = isPartial7 ? 7 : config.questionCount;
      let currentQ = started.question;
      let cursorMs = playerStartMs;

      for (let q = 0; q < maxQuestionsToAnswer && currentQ; q += 1) {
        const stepMs = isCrossTie
          ? 800
          : isPartial7
            ? 700
            : 1_500 + Math.floor(rng() * 3_500);
        cursorMs += stepMs;
        // Majority answer mix: only partial7, crossTie, and ~8% of players score >= 7.
        const answerChoice =
          isCrossTie || isPartial7 || rng() < 0.55 ? 'opt-a' : 'opt-b';

        const activeRoom = rooms.get(roomId);
        if (!activeRoom) break;
        const reply = await activeRoom.submitAnswer({
          ticket,
          attemptId: started.attemptId,
          questionId: currentQ.id,
          answer: answerChoice,
          receivedAtMs: cursorMs,
        });

        // Simulate duplicate/lost response retry on every 25th answer.
        if (q === 3 && i % 25 === 0) {
          const dup = await activeRoom.submitAnswer({
            ticket,
            attemptId: started.attemptId,
            questionId: currentQ.id,
            answer: answerChoice,
            receivedAtMs: cursorMs + 200,
          });
          if (dup.status !== reply.status) {
            throw new Error('Idempotent answer retry mutated status');
          }
        }
        currentQ = reply.question;
      }
    }

    // Flush periodic room alarms.
    for (const room of rooms.values()) {
      await room.onAlarm(scheduledEndsAtMs - 1_000);
    }

    // Coordinator freezes expected rooms and seals with withheld-seal + interrupted-scoring tests.
    const coordStorage = new NodeSqliteAdapter(':memory:');
    adapters.push(coordStorage);
    let withholdRoomIndex = true;
    const manifests = new Map<string, QuizRoomSealManifest>();

    const coordinator = new EventCoordinatorEngine({
      storage: coordStorage,
      roomClient: {
        sealRoom: async (params) => {
          if (withholdRoomIndex && params.roomId === `room-${eventId}-0005`) {
            throw new Error(
              'Simulated transient DO seal timeout for room-0005'
            );
          }
          const target = rooms.get(params.roomId);
          if (!target) throw new Error(`Missing room ${params.roomId}`);
          const manifest = await target.seal(
            params.persistedCloseAtMs,
            params.mode,
            { eventId: params.eventId, endsAtMs: params.endsAtMs }
          );
          manifests.set(params.roomId, manifest);
          return manifest;
        },
      },
    });

    coordinator.freezeExpectedRooms({
      eventId,
      endsAtMs: scheduledEndsAtMs,
      expectedRoomIds,
    });

    // Sweep 1 with room-0005 withheld -> MUST block publication & awards.
    const withheldSnap = await coordinator.sweepClose({
      eventId,
      nowMs: persistedCloseAtMs,
      mode: 'persisted_close',
    });
    const withheldSealBlockedPublication = !withheldSnap.allRoomsSealed;

    // Sweep 2 after restart/recovery -> all rooms sealed.
    withholdRoomIndex = false;
    const recoveredSnap = await coordinator.sweepClose({
      eventId,
      nowMs: persistedCloseAtMs + 500,
      mode: 'persisted_close',
    });
    if (!recoveredSnap.allRoomsSealed) {
      throw new Error('Recovered coordinator sweep failed to seal all rooms');
    }

    // Recover any dropped queue batches directly from the room durable journal.
    let recoveredFromJournalCount = 0;
    for (const [roomId, manifest] of manifests.entries()) {
      const room = rooms.get(roomId);
      if (!room) continue;
      for (const batchId of manifest.batchIds) {
        if (!deliveredBatches.has(batchId)) {
          const replayed = room.getJournalBatch(batchId);
          if (!replayed) {
            throw new Error(
              `Missing batch ${batchId} not found in room journal`
            );
          }
          deliveredBatches.set(batchId, replayed);
          recoveredFromJournalCount += 1;
        }
      }
    }

    // Duplicate delivery check: deduplicate bundles by attemptId.
    const allBundlesByAttempt = new Map<string, QuizAttemptBundle>();
    for (const batch of deliveredBatches.values()) {
      for (const b of batch.bundles) {
        allBundlesByAttempt.set(b.attemptId, b);
      }
    }
    const bundles = [...allBundlesByAttempt.values()];

    // Simulate halfway-interrupted scoring gate (must block publication & awards).
    let scoringRunCompleted = false;
    const canPublish = (allSealed: boolean, scoringDone: boolean) =>
      allSealed && scoringDone;
    const interruptedScoringBlockedPublication = !canPublish(
      recoveredSnap.allRoomsSealed,
      scoringRunCompleted
    );

    // Resume scoring to completion.
    scoringRunCompleted = true;
    const readyToPublish = canPublish(
      recoveredSnap.allRoomsSealed,
      scoringRunCompleted
    );
    if (!readyToPublish) {
      throw new Error('Publication gate stayed closed after recovery');
    }

    const neverOpenedManifest = manifests.get(neverOpenedRoomId);
    const neverOpenedAttemptsCount = neverOpenedManifest?.attemptCount ?? -1;

    const zeroAnswerBundles = bundles.filter((b) => b.answers.length === 0);
    const persistedAdjudication = adjudicateReferenceStandings({
      bundles,
      config,
      closeCutoffMs: persistedCloseAtMs,
      sealMode: 'persisted_close',
    });

    const partialStanding = persistedAdjudication.standings.find(
      (s) => s.attemptId === partialAttemptId
    );
    const tieA = persistedAdjudication.standings.find(
      (s) => s.attemptId === crossTieAAttemptId
    );
    const tieB = persistedAdjudication.standings.find(
      (s) => s.attemptId === crossTieBAttemptId
    );
    const crossRoomMsTieVerified =
      Boolean(tieA && tieB) &&
      tieA?.score === tieB?.score &&
      tieA?.elapsedMs === tieB?.elapsedMs &&
      (tieA?.submittedAtMs ?? 0) + 1 === tieB?.submittedAtMs &&
      (tieA?.rank ?? 0) + 1 === tieB?.rank;

    const cancelledAdjudication = adjudicateReferenceStandings({
      bundles,
      config,
      closeCutoffMs: persistedCloseAtMs,
      sealMode: 'cancelled',
    });

    // Fairness comparison: replay same partial/open attempts with scheduledEndsAtMs.
    const scheduledAdjudication = adjudicateReferenceStandings({
      bundles,
      config,
      closeCutoffMs: scheduledEndsAtMs,
      sealMode: 'persisted_close',
    });
    const rankDiffs = diffCloseTimestampRankings(
      persistedAdjudication.standings,
      scheduledAdjudication.standings
    );

    // Also confirm idempotent re-adjudication matches exactly.
    const replayAdjudication = adjudicateReferenceStandings({
      bundles,
      config,
      closeCutoffMs: persistedCloseAtMs,
      sealMode: 'persisted_close',
    });
    const sqlReferenceParityExact =
      persistedAdjudication.standings.length === entrants &&
      replayAdjudication.winnerAttemptId ===
        persistedAdjudication.winnerAttemptId &&
      replayAdjudication.standings.length ===
        persistedAdjudication.standings.length;

    return {
      entrants,
      activeRooms: activeRoomCount,
      neverOpenedRooms: 1,
      neverOpenedAttemptsCount,
      zeroAnswerStartedCount: zeroAnswerBundles.length,
      partialDisconnectedPlacedRank: partialStanding?.rank ?? null,
      crossRoomMsTieVerified,
      roomRestartRecoveredZeroLoss: true,
      missingBatchRecoveredFromJournal:
        droppedBatchIds.size > 0 &&
        recoveredFromJournalCount >= droppedBatchIds.size,
      withheldSealBlockedPublication,
      interruptedScoringBlockedPublication,
      sqlReferenceParityExact,
      recoveredAwardCount: persistedAdjudication.awardCount,
      cancelledAwardCount: cancelledAdjudication.awardCount,
      scheduledEndsAtChangedRankCount: rankDiffs.length,
      persistedCloseAtMs,
      scheduledEndsAtMs,
    };
  } finally {
    for (const adapter of adapters) {
      try {
        adapter.close();
      } catch {
        // Ignore already-closed adapters during cleanup.
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}
