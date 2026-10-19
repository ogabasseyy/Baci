'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  ActiveBanner,
  MerchantNotificationWithDetails,
} from '@/types/notifications';
import type { MerchantData } from './merchant/types';
import {
  dismissBannerNotification,
  dismissNotification,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from './notification-actions';
import {
  fetchActiveBannersRequest,
  fetchNotificationsRequest,
} from './notification-requests';

export interface UseNotificationsReturn {
  notifications: MerchantNotificationWithDetails[];
  unreadCount: number;
  activeBanners: ActiveBanner[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  dismissBanner: (id: string) => Promise<void>;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

/** Owns the merchant notification fetch + one Realtime channel. */
export function useNotificationsState(
  merchant: MerchantData | null
): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<
    MerchantNotificationWithDetails[]
  >([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeBanners, setActiveBanners] = useState<ActiveBanner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const supabaseRef = useRef(createClient());
  const channelRef = useRef<ReturnType<
    typeof supabaseRef.current.channel
  > | null>(null);
  const isFetchingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const fetchGenerationRef = useRef(0);

  const fetchNotifications = async (append = false) => {
    if (!merchant?.id) return;
    const generation = fetchGenerationRef.current;
    await fetchNotificationsRequest(append, {
      cursor,
      isCurrent: () => fetchGenerationRef.current === generation,
      isFetchingRef,
      pendingRefreshRef,
      setCursor,
      setError,
      setHasMore,
      setIsLoading,
      setNotifications,
      setUnreadCount,
    });
  };

  const fetchActiveBanners = async () => {
    if (!merchant?.id) return;
    const generation = fetchGenerationRef.current;
    await fetchActiveBannersRequest(
      merchant.id,
      supabaseRef.current,
      setActiveBanners,
      () => fetchGenerationRef.current === generation
    );
  };

  /** Subscribe only to this merchant's durable rows; no global payload exists. */
  useEffect(() => {
    const isCurrent = beginNotificationFetchGeneration(
      fetchGenerationRef,
      isFetchingRef,
      pendingRefreshRef
    );
    setNotifications([]);
    setUnreadCount(0);
    setActiveBanners([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setIsLoading(Boolean(merchant?.id));

    if (!merchant?.id) return;

    const supabase = supabaseRef.current;
    const channel = supabase.channel(`merchant-notifications:${merchant.id}`);
    channelRef.current = channel;

    try {
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            filter: `merchant_id=eq.${merchant.id}`,
            schema: 'public',
            table: 'merchant_notifications',
          },
          () => {
            void fetchNotificationsRequest(false, {
              cursor: null,
              isCurrent,
              isFetchingRef,
              pendingRefreshRef,
              setCursor,
              setError,
              setHasMore,
              setIsLoading,
              setNotifications,
              setUnreadCount,
            });
            void fetchActiveBannersRequest(
              merchant.id,
              supabase,
              setActiveBanners,
              isCurrent
            );
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            filter: `merchant_id=eq.${merchant.id}`,
            schema: 'public',
            table: 'merchant_notifications',
          },
          () => {
            // Delivery finalization updates durable recipient rows in the same
            // transaction as the parent becomes sent, making already-mounted
            // merchant clients refetch only after the parent is visible.
            void fetchNotificationsRequest(false, {
              cursor: null,
              isCurrent,
              isFetchingRef,
              pendingRefreshRef,
              setCursor,
              setError,
              setHasMore,
              setIsLoading,
              setNotifications,
              setUnreadCount,
            });
            void fetchActiveBannersRequest(
              merchant.id,
              supabase,
              setActiveBanners,
              isCurrent
            );
          }
        )
        .subscribe((_status, subscriptionError) => {
          if (subscriptionError) {
            console.warn(
              'Notification subscription error:',
              subscriptionError.message
            );
          }
        });
    } catch (error) {
      // Realtime setup can throw synchronously when a channel is already
      // subscribed (for example during a fast client remount). Notifications
      // still load through the initial API request, so keep the dashboard
      // usable and clean up the partially-created channel.
      console.warn(
        'Notification subscription setup failed:',
        error instanceof Error ? error.message : 'Unknown subscription error'
      );
      void supabase.removeChannel(channel);
      channelRef.current = null;
    }

    void fetchNotificationsRequest(false, {
      cursor: null,
      isCurrent,
      isFetchingRef,
      pendingRefreshRef,
      setCursor,
      setError,
      setHasMore,
      setIsLoading,
      setNotifications,
      setUnreadCount,
    });
    void fetchActiveBannersRequest(
      merchant.id,
      supabase,
      setActiveBanners,
      isCurrent
    );

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [merchant?.id]);

  const markAsRead = (id: string) =>
    markNotificationAsRead(id, setNotifications, setUnreadCount);
  const markAllAsRead = () =>
    markAllNotificationsAsRead(notifications, setNotifications, setUnreadCount);
  const dismiss = (id: string) =>
    dismissNotification(id, setNotifications, setUnreadCount);
  const dismissBanner = (id: string) =>
    dismissBannerNotification(id, setActiveBanners);
  const loadMore = async () => {
    if (hasMore && cursor) await fetchNotifications(true);
  };
  const refetch = async () => {
    const generation = fetchGenerationRef.current;
    setCursor(null);
    await fetchNotificationsRequest(false, {
      cursor: null,
      isCurrent: () => fetchGenerationRef.current === generation,
      isFetchingRef,
      pendingRefreshRef,
      queueRefresh: false,
      setCursor,
      setError,
      setHasMore,
      setIsLoading,
      setNotifications,
      setUnreadCount,
    });
    await fetchActiveBanners();
  };

  return {
    notifications,
    unreadCount,
    activeBanners,
    isLoading,
    error,
    hasMore,
    markAsRead,
    markAllAsRead,
    dismiss,
    dismissBanner,
    loadMore,
    refetch,
  };
}

function beginNotificationFetchGeneration(
  fetchGenerationRef: { current: number },
  isFetchingRef: { current: boolean },
  pendingRefreshRef: { current: boolean }
) {
  fetchGenerationRef.current += 1;
  isFetchingRef.current = false;
  pendingRefreshRef.current = false;
  const generation = fetchGenerationRef.current;
  return () => fetchGenerationRef.current === generation;
}
