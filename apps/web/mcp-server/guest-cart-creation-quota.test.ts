import { afterEach, expect, it, vi } from 'vitest';
import {
  GUEST_CART_QUOTA_MAX_CREATIONS as MAX,
  refundGuestCartCreation,
  reserveGuestCartCreation,
  quotaKeyForIp,
} from './guest-cart-creation-quota';

afterEach(() => {
  vi.useRealTimers();
});

it('allows a burst of anonymous carts, then denies until the window rolls', () => {
  for (let i = 0; i < MAX; i += 1) {
    expect(reserveGuestCartCreation('10.0.0.1').allowed).toBe(true);
  }
  const denied = reserveGuestCartCreation('10.0.0.1');
  expect(denied.allowed).toBe(false);
  expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  expect(denied.retryAfterSeconds).toBeLessThanOrEqual(3600);
});

it('tracks callers independently and resets after one hour', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  for (let i = 0; i < MAX; i += 1) {
    reserveGuestCartCreation('10.0.0.2');
  }
  expect(reserveGuestCartCreation('10.0.0.2').allowed).toBe(false);
  expect(reserveGuestCartCreation('10.0.0.3').allowed).toBe(true);
  vi.setSystemTime(new Date('2026-01-01T01:00:01Z'));
  expect(reserveGuestCartCreation('10.0.0.2')).toEqual({
    allowed: true,
    retryAfterSeconds: 0,
    windowStart: new Date('2026-01-01T01:00:01Z').getTime(),
  });
});

it('refunds reservations for creations that never persist', () => {
  for (let i = 0; i < MAX; i += 1) {
    reserveGuestCartCreation('10.0.0.9');
  }
  expect(reserveGuestCartCreation('10.0.0.9').allowed).toBe(false);
  refundGuestCartCreation('10.0.0.9');
  expect(reserveGuestCartCreation('10.0.0.9').allowed).toBe(true);
  expect(reserveGuestCartCreation('10.0.0.9').allowed).toBe(false);
});

it('binds refunds to the reserving window across rollover', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
  const first = reserveGuestCartCreation('10.0.0.11');
  expect(first.allowed).toBe(true);
  vi.setSystemTime(new Date('2026-02-01T01:00:01Z'));
  // A new window: one fresh reservation is consumed here.
  expect(reserveGuestCartCreation('10.0.0.11').allowed).toBe(true);
  // Refunding the previous window's reservation must not inflate the new
  // window past MAX: the fresh window still holds exactly one unit.
  refundGuestCartCreation('10.0.0.11', first.windowStart);
  for (let i = 1; i < MAX; i += 1) {
    expect(reserveGuestCartCreation('10.0.0.11').allowed).toBe(true);
  }
  expect(reserveGuestCartCreation('10.0.0.11').allowed).toBe(false);
});

it('ignores refunds with no matching reservation', () => {
  refundGuestCartCreation('10.0.0.10');
  for (let i = 0; i < MAX; i += 1) {
    expect(reserveGuestCartCreation('10.0.0.10').allowed).toBe(true);
  }
  expect(reserveGuestCartCreation('10.0.0.10').allowed).toBe(false);
});

it('collapses IPv6 spellings of one /64 to a single quota key', () => {
  const keys = new Set([
    quotaKeyForIp('2001:0db8:abcd:0012:0000:0000:0000:0099'),
    quotaKeyForIp('2001:db8:abcd:12::99'),
    quotaKeyForIp('2001:DB8:ABCD:12:0:0:0:99'),
    quotaKeyForIp('2001:db8:abcd:12::99%eth0'),
  ]);
  expect(keys).toEqual(new Set(['2001:db8:abcd:12']));
  expect(quotaKeyForIp('2001:db8:abcd:99::1')).toBe('2001:db8:abcd:99');
  expect(quotaKeyForIp('10.0.0.5')).toBe('10.0.0.5');
  expect(quotaKeyForIp('::ffff:10.0.0.6')).toBe('10.0.0.6');
});

it('shares one creation budget across rotating IPv6 source addresses', () => {
  for (let i = 0; i < MAX; i += 1) {
    expect(
      reserveGuestCartCreation(`2001:db8:ffff::${i.toString(16)}`).allowed
    ).toBe(true);
  }
  expect(
    reserveGuestCartCreation('2001:db8:ffff:0:0:0:0:ffff').allowed
  ).toBe(false);
});

it('rejects fresh callers once the map is full of live windows', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers();
  try {
    // Expire any windows left by earlier tests so the fill below counts
    // exactly: stale entries are swept when the cap is first reached.
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    for (let i = 0; i < 10000; i += 1) {
      const admitted = reserveGuestCartCreation(
        `10.7.${Math.floor(i / 256)}.${i % 256}`
      );
      expect(admitted.allowed).toBe(true);
    }
    expect(reserveGuestCartCreation('10.8.0.1')).toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
    expect(reserveGuestCartCreation('10.8.0.2').allowed).toBe(false);
    expect(
      reserveGuestCartCreation('2001:db8:abcd:12::99').allowed
    ).toBe(false);
    expect(reserveGuestCartCreation('2001:db8::1').allowed).toBe(false);
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('10.8.xxx.xxx');
    expect(logged).not.toContain('10.8.0.1');
    expect(logged).toContain('2001:db8:abcd:12:xxxx');
    expect(logged).not.toContain('2001:db8:abcd:12::99');
    expect(logged).toContain('2001:db8:0:0:xxxx');
    expect(logged).not.toContain('2001:db8::1');
  } finally {
    warn.mockRestore();
  }
});
