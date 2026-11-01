import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNativePreviewController } from './native-preview-controller';
import type {
  NativePreviewInput,
  NativePreviewSession,
} from './native-preview-session-context';
import { useNativePreviewLoadTimeout } from './use-native-preview-load-timeout';

vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));

const nonce = 'a'.repeat(32);
const session: NativePreviewSession = {
  nonce,
  instanceId: 2,
  epoch: 1,
  identityKey: 'user:merchant',
  controller: createNativePreviewController(nonce),
};
const initialInput: NativePreviewInput = {
  identityKey: session.identityKey,
  draftRevision: 1,
  config: {},
  merchant: { id: 'm', slug: 'm' },
  isIdentityCurrent: () => true,
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('fails once and clears only the current session when loading times out', () => {
  const active = { current: session };
  const input = { current: initialInput };
  const onTimeout = vi.fn();
  const view = renderHook(() =>
    useNativePreviewLoadTimeout(session, false, false, active, input, onTimeout)
  );
  act(() => vi.advanceTimersByTime(10_000));
  expect(onTimeout).toHaveBeenCalledExactlyOnceWith('load');
  expect(active.current).toBeNull();
  view.unmount();
});

it('cancels after load and ignores sessions that became stale', () => {
  const active = { current: session };
  const input = { current: initialInput };
  const onTimeout = vi.fn();
  const view = renderHook(
    ({ loaded }) =>
      useNativePreviewLoadTimeout(
        session,
        loaded,
        false,
        active,
        input,
        onTimeout
      ),
    { initialProps: { loaded: false } }
  );
  view.rerender({ loaded: true });
  act(() => vi.advanceTimersByTime(10_000));
  expect(onTimeout).not.toHaveBeenCalled();
  view.rerender({ loaded: false });
  input.current = { ...initialInput, isIdentityCurrent: () => false };
  act(() => vi.advanceTimersByTime(10_000));
  expect(onTimeout).not.toHaveBeenCalled();
  expect(active.current).toBe(session);
  view.unmount();
});
