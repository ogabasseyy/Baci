import type { Dispatch, SetStateAction } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import type {
  ActiveBanner,
  MerchantNotificationWithDetails,
} from '@/types/notifications';

/** Mark one recipient notification as read and update its local representation. */
export async function markNotificationAsRead(
  id: string,
  setNotifications: Dispatch<SetStateAction<MerchantNotificationWithDetails[]>>,
  setUnreadCount: Dispatch<SetStateAction<number>>
): Promise<void> {
  try {
    const response = await fetchWithCsrf(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    if (!response.ok) throw new Error('Failed to mark as read');

    const data = await response.json();
    setNotifications((previous) =>
      previous.map((notification) =>
        notification.id === id
          ? { ...notification, read_at: new Date().toISOString() }
          : notification
      )
    );
    setUnreadCountIfPresent(data.unread_count, setUnreadCount);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

/** Mark every locally unread recipient notification as read. */
export async function markAllNotificationsAsRead(
  notifications: MerchantNotificationWithDetails[],
  setNotifications: Dispatch<SetStateAction<MerchantNotificationWithDetails[]>>,
  setUnreadCount: Dispatch<SetStateAction<number>>
): Promise<void> {
  try {
    if (!notifications.some((notification) => !notification.read_at)) return;

    const response = await fetchWithCsrf('/api/notifications/mark-all-read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Failed to mark all as read');

    setNotifications((previous) =>
      previous.map((notification) => ({
        ...notification,
        read_at: notification.read_at || new Date().toISOString(),
      }))
    );
    const data = await response.json();
    setUnreadCountIfPresent(data.unread_count, setUnreadCount);
  } catch (error) {
    console.error('Error marking all as read:', error);
    throw error;
  }
}

/** Dismiss one recipient notification from the local list. */
export async function dismissNotification(
  id: string,
  setNotifications: Dispatch<SetStateAction<MerchantNotificationWithDetails[]>>,
  setUnreadCount: Dispatch<SetStateAction<number>>
): Promise<void> {
  try {
    const response = await fetchWithCsrf(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    });
    if (!response.ok) throw new Error('Failed to dismiss notification');

    const data = await response.json();
    setNotifications((previous) => previous.filter((item) => item.id !== id));
    setUnreadCountIfPresent(data.unread_count, setUnreadCount);
  } catch (error) {
    console.error('Error dismissing notification:', error);
    throw error;
  }
}

function setUnreadCountIfPresent(
  unreadCount: unknown,
  setUnreadCount: Dispatch<SetStateAction<number>>
) {
  if (typeof unreadCount === 'number') setUnreadCount(unreadCount);
}

/** Dismiss one banner from the local banner list. */
export async function dismissBannerNotification(
  id: string,
  setActiveBanners: Dispatch<SetStateAction<ActiveBanner[]>>
): Promise<void> {
  try {
    const response = await fetchWithCsrf(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banner_dismissed: true }),
    });
    if (!response.ok) throw new Error('Failed to dismiss banner');

    setActiveBanners((previous) =>
      previous.filter((banner) => banner.id !== id)
    );
  } catch (error) {
    console.error('Error dismissing banner:', error);
    throw error;
  }
}
