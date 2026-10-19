import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { expect, it, vi } from 'vitest';
import { useFundingDetails } from './use-funding-details';

function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const ready = {
  status: 'ready',
  accounts: [
    {
      accountNumber: '0000000001',
      accountName: 'Synthetic account',
      bankName: 'Synthetic bank',
    },
  ],
};

it.each([
  null,
  'session-b:goal-b',
])('never commits stale ready details when A returns after %s', async (intermediateKey) => {
  const first = deferred();
  const intermediate = deferred();
  const returned = deferred();
  const load = vi
    .fn<Parameters<typeof useFundingDetails>[1]>()
    .mockReturnValueOnce(first.promise);
  if (intermediateKey) load.mockReturnValueOnce(intermediate.promise);
  load.mockReturnValueOnce(returned.promise);
  const commits: string[] = [];
  const { rerender } = renderHook(
    ({ requestKey }: { requestKey: string | null }) => {
      const view = useFundingDetails(requestKey, load);
      useLayoutEffect(() => {
        commits.push(view.status);
      });
      return view;
    },
    { initialProps: { requestKey: 'session-a:goal-a' as string | null } }
  );
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await act(async () => first.resolve(ready));
  expect(commits.at(-1)).toBe('ready');

  rerender({ requestKey: intermediateKey });
  expect(load.mock.calls[0][1].aborted).toBe(true);
  if (intermediateKey) {
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  }
  commits.length = 0;
  rerender({ requestKey: 'session-a:goal-a' });
  await waitFor(() =>
    expect(load).toHaveBeenCalledTimes(intermediateKey ? 3 : 2)
  );

  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every((status) => status === 'loading')).toBe(true);
  if (intermediateKey) {
    expect(load.mock.calls[1][1].aborted).toBe(true);
    await act(async () => intermediate.resolve(ready));
    expect(commits.every((status) => status === 'loading')).toBe(true);
  }
  await act(async () => returned.resolve({ status: 'pending' }));
  expect(commits.at(-1)).toBe('pending');
});

it('invalidates ready results across loader replacement and restoration', async () => {
  const replacement = deferred();
  const returned = deferred();
  const originalLoad = vi
    .fn<Parameters<typeof useFundingDetails>[1]>()
    .mockResolvedValueOnce(ready)
    .mockReturnValueOnce(returned.promise);
  const replacementLoad = vi
    .fn<Parameters<typeof useFundingDetails>[1]>()
    .mockReturnValue(replacement.promise);
  const commits: string[] = [];
  const { rerender } = renderHook(
    ({ load }: { load: Parameters<typeof useFundingDetails>[1] }) => {
      const view = useFundingDetails('session-a:goal-a', load);
      useLayoutEffect(() => {
        commits.push(view.status);
      });
      return view;
    },
    { initialProps: { load: originalLoad } }
  );
  await waitFor(() => expect(commits.at(-1)).toBe('ready'));

  commits.length = 0;
  rerender({ load: replacementLoad });
  await waitFor(() => expect(replacementLoad).toHaveBeenCalledTimes(1));
  rerender({ load: originalLoad });
  await waitFor(() => expect(originalLoad).toHaveBeenCalledTimes(2));
  await act(async () => replacement.resolve(ready));

  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every((status) => status === 'loading')).toBe(true);
  expect(replacementLoad.mock.calls[0][1].aborted).toBe(true);
  await act(async () => returned.resolve({ status: 'unavailable' }));
  expect(commits.at(-1)).toBe('unavailable');
});

it('aborts work on unmount and does not load when unauthenticated', async () => {
  const load = vi.fn<
    (requestKey: string, signal: AbortSignal) => Promise<unknown>
  >(async () => ({ status: 'pending' }));
  const { result, rerender, unmount } = renderHook(
    ({ key }) => useFundingDetails(key, load),
    { initialProps: { key: null as string | null } }
  );
  expect(result.current.status).toBe('unavailable');
  expect(load).not.toHaveBeenCalled();
  rerender({ key: 'synthetic-session:goal' });
  await waitFor(() => expect(result.current.status).toBe('pending'));
  const signal = load.mock.calls[0][1];
  act(() => unmount());
  expect(signal.aborted).toBe(true);
});
