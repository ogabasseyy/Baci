import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOtpSuccessTransition } from './use-otp-success-transition';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('starts only when called after confirmation and holds the next screen for the success animation', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(useOtpSuccessTransition);
  let complete = false;
  expect(result.current.verified).toBe(false);
  act(() => {
    void result.current.showSuccess().then(() => {
      complete = true;
    });
  });
  expect(result.current.verified).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(799);
  });
  expect(complete).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(complete).toBe(true);
});
it('releases the transition and clears its timer if the popup unmounts', async () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(useOtpSuccessTransition);
  let complete = false;
  act(() => {
    void result.current.showSuccess().then(() => {
      complete = true;
    });
  });
  unmount();
  await act(async () => {});
  expect(complete).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('skips the animation pause for reduced motion', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const { result } = renderHook(useOtpSuccessTransition);
  await act(async () => {
    await result.current.showSuccess();
  });
  expect(result.current.verified).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
