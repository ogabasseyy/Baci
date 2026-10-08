import { afterEach, expect, it, vi } from 'vitest';
import {
  GUEST_CART_QUOTA_MAX_CREATIONS as MAX,
  consumeGuestCartCreation,
  peekGuestCartCreation,
} from './guest-cart-creation-quota';

afterEach(() => {
  vi.useRealTimers();
});

it('allows a burst of anonymous carts, then denies until the window rolls', () => {
  for (let i = 0; i < MAX; i += 1) {
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
  for (let i = 0; i < MAX; i += 1) {
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

it('peeks without consuming so failed validations burn no quota', () => {
  for (let i = 0; i < MAX + 5; i += 1) {
    expect(peekGuestCartCreation('10.0.0.9').allowed).toBe(true);
  }
  for (let i = 0; i < MAX; i += 1) {
    consumeGuestCartCreation('10.0.0.9');
  }
  expect(peekGuestCartCreation('10.0.0.9').allowed).toBe(false);
});

it('rejects fresh callers once the map is full of live windows', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    // Expire any windows left by earlier tests so the fill below counts
    // exactly: stale entries are swept when the cap is first reached.
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    for (let i = 0; i < 10000; i += 1) {
      const admitted = consumeGuestCartCreation(
        `10.7.${Math.floor(i / 256)}.${i % 256}`
      );
      expect(admitted.allowed).toBe(true);
    }
    expect(consumeGuestCartCreation('10.8.0.1')).toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
    expect(consumeGuestCartCreation('10.8.0.2').allowed).toBe(false);
  } finally {
    warn.mockRestore();
  }
});
