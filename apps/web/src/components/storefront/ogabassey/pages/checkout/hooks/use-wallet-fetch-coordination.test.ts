import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWalletFetchCoordination } from './use-wallet-fetch-coordination';

describe('useWalletFetchCoordination', () => {
  it('raises initial-read-pending on identity claim and clears it when the first fetch settles', () => {
    const { result } = renderHook(() => useWalletFetchCoordination());
    expect(result.current.isInitialReadPending()).toBe(false);
    expect(result.current.isRefreshPending()).toBe(false);

    act(() => {
      result.current.claimIdentity('user-1:ogabassey');
    });
    expect(result.current.isInitialReadPending()).toBe(true);
    expect(result.current.isRefreshPending()).toBe(false);

    const generation = result.current.fetchGenerationRef.current;
    let ownsOutcome = false;
    act(() => {
      ownsOutcome = result.current.settleFetch(generation, {
        fetchTimedOut: false,
        signalAborted: false,
      });
    });
    expect(ownsOutcome).toBe(true);
    expect(result.current.isInitialReadPending()).toBe(false);
  });

  it('leaves the flags untouched for a null identity (signed out schedules no fetch)', () => {
    const { result } = renderHook(() => useWalletFetchCoordination());
    const before = result.current.fetchGenerationRef.current;
    act(() => {
      result.current.claimIdentity(null);
    });
    expect(result.current.isInitialReadPending()).toBe(false);
    expect(result.current.isRefreshPending()).toBe(false);
    // ...but the generation still advances so a stale in-flight
    // response cannot repopulate the signed-out session.
    expect(result.current.fetchGenerationRef.current).toBe(before + 1);
  });

  it('raises refresh-pending on refresh claim and ignores superseded settles', () => {
    const { result } = renderHook(() => useWalletFetchCoordination());
    act(() => {
      result.current.claimRefresh();
    });
    expect(result.current.isRefreshPending()).toBe(true);
    const stale = result.current.fetchGenerationRef.current;
    act(() => {
      result.current.claimRefresh();
    });

    let ownsOutcome = true;
    act(() => {
      ownsOutcome = result.current.settleFetch(stale, {
        fetchTimedOut: false,
        signalAborted: true,
      });
    });
    expect(ownsOutcome).toBe(false);
    // The stale finish must not clear the successor's pending flag.
    expect(result.current.isRefreshPending()).toBe(true);
  });

  it('clears on a timeout abort with no successor', () => {
    const { result } = renderHook(() => useWalletFetchCoordination());
    act(() => {
      result.current.claimRefresh();
    });
    const generation = result.current.fetchGenerationRef.current;
    let ownsOutcome = false;
    act(() => {
      ownsOutcome = result.current.settleFetch(generation, {
        fetchTimedOut: true,
        signalAborted: true,
      });
    });
    expect(ownsOutcome).toBe(true);
    expect(result.current.isRefreshPending()).toBe(false);
  });
});
