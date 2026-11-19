import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOtpResendCooldown } from './use-otp-resend-cooldown';

afterEach(() => vi.useRealTimers());
it('blocks until the caller-owned deadline and restarts only on a new send time', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
  const { result, rerender } = renderHook(
    ({ sentAt }) => useOtpResendCooldown(sentAt, 30),
    { initialProps: { sentAt: Date.now() } }
  );
  expect(result.current.canResend()).toBe(false);
  expect(result.current.remainingSeconds).toBe(30);
  act(() => vi.advanceTimersByTime(30000));
  expect(result.current.canResend()).toBe(true);
  rerender({ sentAt: Date.now() });
  expect(result.current.canResend()).toBe(false);
});
it('does not impose a cooldown without a timestamp or opt-in', () => {
  const { result } = renderHook(() => useOtpResendCooldown(undefined, 0));
  expect(result.current.canResend()).toBe(true);
  expect(result.current.remainingSeconds).toBe(0);
});

it.each([
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
])('allows explicit resend when the send time is unknown: %s', (sentAt) => {
  const { result } = renderHook(() => useOtpResendCooldown(sentAt, 30));
  expect(result.current.canResend()).toBe(true);
  expect(result.current.remainingSeconds).toBe(0);
});
