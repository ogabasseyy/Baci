import { waitingRoomRetryDelay } from './quiz-waiting-room-retry-delay';

describe('waitingRoomRetryDelay', () => {
  const centred = () => 0.5;

  it('backs off 1, 2, 4 then 5 s for ordinary failures', () => {
    const offline = new Error('offline');
    expect(waitingRoomRetryDelay(1, offline, centred)).toBe(1_000);
    expect(waitingRoomRetryDelay(2, offline, centred)).toBe(2_000);
    expect(waitingRoomRetryDelay(3, offline, centred)).toBe(4_000);
    expect(waitingRoomRetryDelay(4, offline, centred)).toBe(5_000);
  });

  it('waits at least 5 s once the server says it is overloaded', () => {
    expect(waitingRoomRetryDelay(1, { status: 503 }, () => 0)).toBe(5_000);
    expect(waitingRoomRetryDelay(1, { status: 429 }, centred)).toBe(5_000);
  });
});
