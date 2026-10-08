import { afterEach, expect, it, vi } from 'vitest';
import { consumeGuestCartCreation } from './guest-cart-creation-quota';

afterEach(() => {
  vi.useRealTimers();
});

it('allows a burst of anonymous carts, then denies until the window rolls', () => {
  for (let i = 0; i < 20; i += 1) {
    expect(consumeGuestCartCreation('10.0.0.1').allowed).toBe(true);
  }
  const denied = consumeGuestCartCreation('10.0.0.1');
  expect(denied.allowed).toBe(false);
  expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  expect(denied.retryAfterSeconds).toBeLessThanOrEqual(3600);
});

it('tracks callers independently and resets after one hour', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  for (let i = 0; i < 20; i += 1) {
    consumeGuestCartCreation('10.0.0.2');
  }
  expect(consumeGuestCartCreation('10.0.0.2').allowed).toBe(false);
  expect(consumeGuestCartCreation('10.0.0.3').allowed).toBe(true);
  vi.setSystemTime(new Date('2026-01-01T01:00:01Z'));
  expect(consumeGuestCartCreation('10.0.0.2')).toEqual({
    allowed: true,
    retryAfterSeconds: 0,
  });
});
