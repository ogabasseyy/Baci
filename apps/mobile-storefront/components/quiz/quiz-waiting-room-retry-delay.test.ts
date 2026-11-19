import {
  waitingRoomPendingDelay,
  waitingRoomRetryDelay,
} from './quiz-waiting-room-retry-delay';

describe('waitingRoomRetryDelay', () => {
  const centred = () => 0.5;

  it('backs off 1, 2, 4 then 5 s for ordinary failures', () => {
    const offline = new Error('offline');
    expect(waitingRoomRetryDelay(1, offline, centred)).toBe(1_000);
    expect(waitingRoomRetryDelay(2, offline, centred)).toBe(2_000);
    expect(waitingRoomRetryDelay(3, offline, centred)).toBe(4_000);
    expect(waitingRoomRetryDelay(4, offline, centred)).toBe(5_000);
  });

  it('waits 5 to 7 s once the server says it is overloaded', () => {
    expect(waitingRoomRetryDelay(1, { status: 503 }, () => 0)).toBe(5_000);
    expect(waitingRoomRetryDelay(1, { status: 429 }, centred)).toBe(6_000);
    expect(waitingRoomRetryDelay(1, { status: 429 }, () => 1)).toBe(7_000);
  });
});

describe('waitingRoomPendingDelay', () => {
  it('widens 1, 2, 4 then 5 s while the quiz is still scheduled', () => {
    const centred = () => 0.5;
    expect(waitingRoomPendingDelay(1, centred)).toBe(1_000);
    expect(waitingRoomPendingDelay(2, centred)).toBe(2_000);
    expect(waitingRoomPendingDelay(3, centred)).toBe(4_000);
    expect(waitingRoomPendingDelay(4, centred)).toBe(5_000);
    expect(waitingRoomPendingDelay(9, centred)).toBe(5_000);
  });

  it('spreads phones around each gap', () => {
    expect(waitingRoomPendingDelay(2, () => 0)).toBe(1_600);
    expect(waitingRoomPendingDelay(2, () => 1)).toBe(2_400);
  });
});
