import { uuidFromIndex } from './pg-rpc-bridge.mjs';

export async function playAndSealE2eRooms({
  eventId,
  merchantId,
  startsAtMs,
  endsAtMs,
  closeMs,
  roomIds,
  slots,
  players,
  adapters,
  QuizControlStateStore,
  createEmptyControlState,
  EventCoordinatorEngine,
  NodeSqliteAdapter,
  QuizRoomEngine,
}) {
  const packedByRoom = new Map(roomIds.map((r) => [r, []]));
  const rooms = new Map();
  const controlState = new QuizControlStateStore(
    createEmptyControlState(startsAtMs, 1)
  );
  const eventConfig = {
    eventId,
    merchantId,
    mode: 'live',
    contractVersion: 2,
    rulesVersion: '2026-11',
    questionCount: 10,
    timePerQuestionSeconds: 10,
    maxAttempts: 1,
    startsAtMs,
    endsAtMs: closeMs + 10_000,
    status: 'active',
    slots,
  };

  for (const roomId of roomIds) {
    const adapter = new NodeSqliteAdapter(':memory:');
    adapters.push(adapter);
    const engine = new QuizRoomEngine({
      roomId,
      storage: adapter,
      controlState,
      hooks: {
        onPublishBatches: (msgs) =>
          packedByRoom.get(roomId)?.push(...msgs.map((m) => m.message)),
      },
    });
    engine.initialize(eventConfig);
    rooms.set(roomId, engine);
  }

  for (const pl of players) {
    const room = rooms.get(pl.roomId);
    const ticket = {
      userId: pl.userId,
      customerId: pl.custId,
      merchantId,
      eventId,
      roomId: pl.roomId,
      deviceHash: pl.deviceHash,
      leaderboardUsername: `p_${pl.p}`,
      expiresAtMs: closeMs + 60_000,
      admissionId: pl.admId,
      mode: 'live',
      issuedAtMs: startsAtMs,
    };
    const started = room.startAttempt({
      ticket,
      integrityTier: 'device',
      acceptedRulesVersion: '2026-11',
      termsAccepted: true,
      startRequestId: uuidFromIndex('90000000', pl.p),
      appVersion: '2.10.0',
      platform: 'android',
      nowMs: startsAtMs + pl.p * 100,
    });
    let q = started.question;
    let ts = startsAtMs + pl.p * 100;
    while (q) {
      ts += 1_200 + pl.p * 20;
      const reply = await room.submitAnswer({
        ticket,
        attemptId: started.attemptId,
        questionId: q.id,
        answer: pl.p === 1 || q.index <= 7 ? 'opt-a' : 'opt-b',
        receivedAtMs: ts,
      });
      q = reply.question;
    }
  }

  const coordAdapter = new NodeSqliteAdapter(':memory:');
  adapters.push(coordAdapter);
  const coordinator = new EventCoordinatorEngine({
    storage: coordAdapter,
    roomClient: {
      sealRoom: async ({
        eventId: eid,
        roomId: rid,
        persistedCloseAtMs,
        mode,
        endsAtMs: eMs,
      }) =>
        rooms
          .get(rid)
          .seal(persistedCloseAtMs, mode, { eventId: eid, endsAtMs: eMs }),
    },
  });
  coordinator.freezeExpectedRooms({
    eventId,
    endsAtMs,
    expectedRoomIds: roomIds,
  });
  const coordSnap = await coordinator.sweepClose({
    eventId,
    nowMs: closeMs,
    mode: 'persisted_close',
  });

  return { rooms, packedByRoom, coordSnap };
}
