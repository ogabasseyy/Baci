import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfirmedOffline } from './use-confirmed-offline';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useConfirmedOffline', () => {
  it('does not show an offline notice when navigator reports offline but requests succeed', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useConfirmedOffline());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('shows offline only after a failed reachability check and clears on reconnect', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failed')));
    const { result } = renderHook(() => useConfirmedOffline());
    await waitFor(() => expect(result.current).toBe(true));
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current).toBe(false);
  });

  it('ignores an old failed request after reconnecting', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    let rejectRequest: (error: Error) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_, reject) => { rejectRequest = reject; })));
    const { result } = renderHook(() => useConfirmedOffline());
    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      rejectRequest(new Error('aborted'));
    });
    expect(result.current).toBe(false);
  });
});
