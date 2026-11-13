import { describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useUserPullRefresh } from './use-user-pull-refresh';

describe('useUserPullRefresh', () => {
  it('is not refreshing until the customer pulls', () => {
    const { result } = renderHook(() => useUserPullRefresh(() => undefined));
    expect(result.current.refreshing).toBe(false);
  });

  it('shows the spinner during the pull and clears it when the refetch ends', async () => {
    let finish: () => void = () => undefined;
    const refetch = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const { result } = renderHook(() => useUserPullRefresh(refetch));

    let pull: Promise<void> = Promise.resolve();
    act(() => {
      pull = result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      finish();
      await pull;
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('clears the spinner when the refetch fails', async () => {
    const { result } = renderHook(() =>
      useUserPullRefresh(() => Promise.reject(new Error('offline')))
    );

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(result.current.refreshing).toBe(false);
  });
});
