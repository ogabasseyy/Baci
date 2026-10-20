import { act, renderHook } from '@testing-library/react-native';
import { useSavedCartRead } from './use-saved-cart-read';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('does not let a stale owner completion mark the new scope ready', async () => {
  const first = deferred<void>();
  const loadSavedCart = jest
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(undefined);
  const scopeA = { userId: 'user-a', generation: 0 };
  const scopeB = { userId: 'user-b', generation: 1 };
  const { result, rerender } = renderHook(
    (props: { scope: typeof scopeA }) =>
      useSavedCartRead({
        userId: props.scope.userId,
        loadSavedCart,
        accountsEnabled: true,
        ownerScope: props.scope,
      }),
    { initialProps: { scope: scopeA } }
  );
  rerender({ scope: scopeB });
  await act(async () => {
    first.resolve(undefined);
  });
  // The second (current-scope) read resolved immediately; the stale
  // first completion must not flip the state for the new owner.
  expect(result.current.savedRead.scope).toBe(scopeB);
  expect(result.current.savedRead.status).toBe('ready');
  expect(loadSavedCart).toHaveBeenCalledTimes(2);
});

it('keeps a failed read in error until retrySavedRead succeeds', async () => {
  const loadSavedCart = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const scope = { userId: 'user-a', generation: 0 };
  const { result } = renderHook(() =>
    useSavedCartRead({
      userId: 'user-a',
      loadSavedCart,
      accountsEnabled: true,
      ownerScope: scope,
    })
  );
  await act(async () => {});
  expect(result.current.savedRead).toEqual({ scope, status: 'error' });
  await act(async () => {
    result.current.retrySavedRead();
  });
  expect(result.current.savedRead).toEqual({ scope, status: 'ready' });
  expect(loadSavedCart).toHaveBeenCalledTimes(2);
});

it('fires onStart once per new read', async () => {
  const onStart = jest.fn();
  const loadSavedCart = jest.fn().mockResolvedValue(undefined);
  const scope = { userId: 'user-a', generation: 0 };
  const { result } = renderHook(() =>
    useSavedCartRead({
      userId: 'user-a',
      loadSavedCart,
      accountsEnabled: true,
      ownerScope: scope,
      onStart,
    })
  );
  await act(async () => {});
  expect(onStart).toHaveBeenCalledTimes(1);
  await act(async () => {
    result.current.retrySavedRead();
  });
  expect(onStart).toHaveBeenCalledTimes(2);
});
