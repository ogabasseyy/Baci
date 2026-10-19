import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './use-notifications.test-support';
import { useNotifications } from './use-notifications';
import { renderNotificationsHook } from './use-notifications.test-render';
import {
  notificationMocks,
  resetNotificationHookMocks,
  setMerchant,
} from './use-notifications.test-support';

beforeEach(resetNotificationHookMocks);

function findUpdateHandler(calls: readonly unknown[][]): (() => void) | null {
  for (const call of calls) {
    const [, filter, handler] = call;
    if (
      call[0] === 'postgres_changes' &&
      filter !== null &&
      typeof filter === 'object' &&
      'event' in filter &&
      filter.event === 'UPDATE' &&
      isVoidHandler(handler)
    ) {
      return handler;
    }
  }
  return null;
}

function isVoidHandler(value: unknown): value is () => void {
  return typeof value === 'function';
}

describe('useNotifications Realtime subscription', () => {
  it('subscribes to only the current merchant for INSERT and UPDATE changes', async () => {
    renderNotificationsHook(() => useNotifications());

    await waitFor(() => {
      expect(notificationMocks.supabaseChannel).toHaveBeenCalledWith(
        'merchant-notifications:merchant-123'
      );
    });

    const insertFilter = {
      event: 'INSERT',
      filter: 'merchant_id=eq.merchant-123',
      schema: 'public',
      table: 'merchant_notifications',
    };
    const updateFilter = { ...insertFilter, event: 'UPDATE' };
    expect(notificationMocks.channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      insertFilter,
      expect.any(Function)
    );
    expect(notificationMocks.channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      updateFilter,
      expect.any(Function)
    );
    expect(notificationMocks.channel.subscribe).toHaveBeenCalled();
  });

  it('does not subscribe when merchant context is absent', async () => {
    setMerchant(null);

    renderNotificationsHook(() => useNotifications());
    await Promise.resolve();

    expect(notificationMocks.supabaseChannel).not.toHaveBeenCalled();
  });

  it('removes the merchant-scoped channel on unmount', async () => {
    const { unmount } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => {
      expect(notificationMocks.supabaseChannel).toHaveBeenCalled();
    });
    unmount();

    expect(notificationMocks.removeChannel).toHaveBeenCalledWith(
      notificationMocks.channel
    );
  });

  it('warns without throwing when the subscription fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let callback: (status: string, error?: { message: string }) => void = () =>
      undefined;
    notificationMocks.channel.subscribe.mockImplementation((handler) => {
      callback = handler;
      return notificationMocks.channel;
    });

    renderNotificationsHook(() => useNotifications());

    await waitFor(() =>
      expect(notificationMocks.channel.subscribe).toHaveBeenCalled()
    );
    callback('CHANNEL_ERROR', { message: 'Connection failed' });

    expect(warn).toHaveBeenCalledWith(
      'Notification subscription error:',
      'Connection failed'
    );
    warn.mockRestore();
  });

  it('bugfix: bell and banner share one merchant-notifications channel', async () => {
    function useBellAndBanner() {
      return [useNotifications(), useNotifications()] as const;
    }

    renderNotificationsHook(() => useBellAndBanner());

    await waitFor(() => {
      expect(notificationMocks.supabaseChannel).toHaveBeenCalledTimes(1);
    });
    expect(notificationMocks.supabaseChannel).toHaveBeenCalledWith(
      'merchant-notifications:merchant-123'
    );
    expect(notificationMocks.channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the dashboard usable when channel setup throws synchronously', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    notificationMocks.channel.on.mockImplementationOnce(() => {
      throw new Error('channel is already subscribed');
    });

    expect(() =>
      renderNotificationsHook(() => useNotifications())
    ).not.toThrow();

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        'Notification subscription setup failed:',
        'channel is already subscribed'
      )
    );
    expect(notificationMocks.removeChannel).toHaveBeenCalledWith(
      notificationMocks.channel
    );
    warn.mockRestore();
  });

  it('cleans up when subscribe throws after both handlers are registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    notificationMocks.channel.subscribe.mockImplementation(() => {
      throw new Error('subscribe failed');
    });

    try {
      expect(() =>
        renderNotificationsHook(() => useNotifications())
      ).not.toThrow();

      await waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          'Notification subscription setup failed:',
          'subscribe failed'
        )
      );
      expect(notificationMocks.channel.on).toHaveBeenCalledTimes(2);
      expect(notificationMocks.removeChannel).toHaveBeenCalledWith(
        notificationMocks.channel
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('refetches after the finalized recipient UPDATE that follows a hidden INSERT', async () => {
    renderNotificationsHook(() => useNotifications());

    await waitFor(() =>
      expect(notificationMocks.channel.on).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({ event: 'UPDATE' }),
        expect.any(Function)
      )
    );
    const updateHandler = findUpdateHandler(
      notificationMocks.channel.on.mock.calls
    );
    expect(updateHandler).not.toBeNull();
    if (!updateHandler) throw new Error('Expected an UPDATE subscription');

    vi.mocked(global.fetch).mockClear();
    notificationMocks.rpc.mockClear();
    act(() => updateHandler());

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(notificationMocks.rpc).toHaveBeenCalledWith('get_active_banners', {
      p_merchant_id: 'merchant-123',
    });
  });
});
