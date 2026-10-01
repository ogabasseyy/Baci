import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantData } from './merchant/types';
import './use-notifications.test-support';
import {
  notificationMocks,
  notificationResponse,
  notificationRow,
  resetNotificationHookMocks,
} from './use-notifications.test-support';
import { useNotificationsState } from './use-notifications-state';

beforeEach(resetNotificationHookMocks);

describe('useNotificationsState', () => {
  it('owns a single merchant-scoped realtime channel', async () => {
    renderHook(() =>
      useNotificationsState({ id: 'merchant-123' } as MerchantData)
    );

    await waitFor(() => {
      expect(notificationMocks.supabaseChannel).toHaveBeenCalledTimes(1);
    });
    expect(notificationMocks.supabaseChannel).toHaveBeenCalledWith(
      'merchant-notifications:merchant-123'
    );
  });

  it('does not subscribe without a merchant', async () => {
    renderHook(() => useNotificationsState(null));
    await Promise.resolve();

    expect(notificationMocks.supabaseChannel).not.toHaveBeenCalled();
  });

  it('does not remain loading when merchant context is absent', () => {
    const { result } = renderHook(() => useNotificationsState(null));

    expect(result.current.isLoading).toBe(false);
  });

  it('does not apply an earlier merchant response after switching merchants', async () => {
    let resolveFirstRequest!: (response: {
      json: () => Promise<ReturnType<typeof notificationResponse>>;
      ok: boolean;
    }) => void;
    const firstRequest = new Promise<{
      json: () => Promise<ReturnType<typeof notificationResponse>>;
      ok: boolean;
    }>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const merchantBNotification = notificationRow({
      id: 'merchant-b-notification',
      merchant_id: 'merchant-b',
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce({
        json: async () => notificationResponse([merchantBNotification]),
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ merchant }: { merchant: MerchantData | null }) =>
        useNotificationsState(merchant),
      {
        initialProps: { merchant: { id: 'merchant-a' } as MerchantData },
      }
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ merchant: { id: 'merchant-b' } as MerchantData });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.current.notifications).toEqual([merchantBNotification]);
    });

    await act(async () => {
      resolveFirstRequest({
        json: async () =>
          notificationResponse([
            notificationRow({ id: 'stale-merchant-a-notification' }),
          ]),
        ok: true,
      });
      await firstRequest;
    });

    expect(result.current.notifications).toEqual([merchantBNotification]);
  });
});
