import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOtpExpiry } from './use-otp-expiry';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

it.each([
  [Number.NaN, 300],
  [Number.POSITIVE_INFINITY, 300],
  [Number.NEGATIVE_INFINITY, 300],
  [1_000_000, 0],
  [1_000_000, -1],
  [1_000_000, Number.POSITIVE_INFINITY],
  [1_000_000, Number.NEGATIVE_INFINITY],
  [1_000_000, Number.NaN],
])('fails closed for invalid timing parameters', (sentAt, ttlSeconds) => {
  const { result } = renderHook(() => useOtpExpiry(sentAt, ttlSeconds));
  expect(result.current.expired).toBe(true);
  expect(result.current.expiresAt).toBeNull();
});

it('updates its deadline when a new code is sent', () => {
  const { result, rerender } = renderHook(
    ({ sentAt }: { sentAt: number }) => useOtpExpiry(sentAt, 60),
    { initialProps: { sentAt: Date.now() } }
  );
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.expired).toBe(true);
  rerender({ sentAt: Date.now() });
  expect(result.current.expired).toBe(false);
  expect(result.current.remainingSeconds).toBe(60);
});

it('catches up to the deadline when a stopped timer restarts', () => {
  const sentAt = Date.now();
  const { result, rerender } = renderHook(
    ({ running }: { running: boolean }) => useOtpExpiry(sentAt, 60, running),
    { initialProps: { running: true } }
  );
  rerender({ running: false });
  act(() => vi.advanceTimersByTime(90_000));
  rerender({ running: true });
  expect(result.current.expired).toBe(true);
  expect(result.current.remainingSeconds).toBe(0);
});

it('replaces an active timer and expires at the new deadline', () => {
  const { result, rerender } = renderHook(
    ({ sentAt }: { sentAt: number }) => useOtpExpiry(sentAt, 60),
    { initialProps: { sentAt: Date.now() } }
  );
  act(() => vi.advanceTimersByTime(30_000));
  const replacement = Date.now();
  rerender({ sentAt: replacement });
  expect(result.current.expiresAt).toBe(replacement + 60_000);
  act(() => vi.advanceTimersByTime(30_000));
  expect(result.current.remainingSeconds).toBe(30);
  act(() => vi.advanceTimersByTime(30_000));
  expect(result.current.expired).toBe(true);
});

it('resumes ticking after restarting before the deadline', () => {
  const sentAt = Date.now();
  const { result, rerender } = renderHook(
    ({ running }: { running: boolean }) => useOtpExpiry(sentAt, 60, running),
    { initialProps: { running: true } }
  );
  act(() => vi.advanceTimersByTime(10_000));
  rerender({ running: false });
  act(() => vi.advanceTimersByTime(20_000));
  rerender({ running: true });
  expect(result.current.remainingSeconds).toBe(30);
  act(() => vi.advanceTimersByTime(30_000));
  expect(result.current.expired).toBe(true);
});
