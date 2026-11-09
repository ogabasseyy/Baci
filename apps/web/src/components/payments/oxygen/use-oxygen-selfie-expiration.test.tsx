import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOxygenSelfieExpiration } from './use-oxygen-selfie-expiration';

afterEach(() => vi.useRealTimers());
it('returns the latest usable link immediately and remembers it after expiry', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  const url = (seconds: number) =>
    `https://selfie.example/?securityToken=a.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.c`;
  const first = url(30);
  const next = url(60);
  const { result, rerender } = renderHook(
    (link) => useOxygenSelfieExpiration(link, true, true),
    { initialProps: first }
  );
  expect(result.current.lastUsableSelfie).toBe(first);
  rerender(next);
  expect(result.current.lastUsableSelfie).toBe(next);
  act(() => vi.advanceTimersByTime(61000));
  expect(result.current.expiredSelfie).toBe(true);
  expect(result.current.lastUsableSelfie).toBe(next);
});
