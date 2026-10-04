import { useEffect, useRef, useState } from 'react';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { getRegisteredPushToken } from '@/lib/push-token-storage';
import type {
  SavingsNotification,
  SavingsNotificationPreferences,
  SavingsNotificationPreferencesPatch,
} from '@/schemas/savings-notifications';
import { savingsNotificationCapability } from '@/services/savings-notification-capability';
import { savingsNotificationEvents } from '@/services/savings-notification-events';
import {
  fetchSavingsNotificationInbox,
  markSavingsNotificationRead,
  updateSavingsNotificationPreferences,
} from '@/services/savings-notification-inbox';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';

type InboxState = {
  error: string | null;
  notifications: SavingsNotification[];
  preferences: SavingsNotificationPreferences | null;
  scope: string | null;
  status: 'idle' | 'loading' | 'ready';
};

const INITIAL_INBOX_STATE: InboxState = {
  error: null,
  notifications: [],
  preferences: null,
  scope: null,
  status: 'idle',
};

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Unable to update savings notifications. Please try again.';
}

export function useSavingsNotificationInbox({
  enabled,
  merchantId,
  userId,
}: {
  enabled: boolean;
  merchantId: string | null;
  userId: string | null;
}) {
  const activeMerchantId = merchantId?.trim() || null;
  const activeUserId = userId?.trim() || null;
  const scope =
    enabled && activeMerchantId && activeUserId
      ? `${activeMerchantId}:${activeUserId}`
      : null;
  const scopeRef = useRef(scope);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState<InboxState>(INITIAL_INBOX_STATE);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isCurrentScope = state.scope === scope;

  useEffect(() => {
    if (!scope || !activeMerchantId || !activeUserId) return;
    return savingsNotificationEvents.subscribe(
      { merchantId: activeMerchantId, userId: activeUserId },
      () => setReloadVersion((version) => version + 1)
    );
  }, [activeMerchantId, activeUserId, scope]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry increments reloadVersion to re-run this request.
  useEffect(() => {
    scopeRef.current = scope;
    let active = true;

    if (!scope || !activeMerchantId || !activeUserId) {
      setState(INITIAL_INBOX_STATE);
      setActionError(null);
      setIsSaving(false);
      return () => {
        active = false;
      };
    }

    setState({
      error: null,
      notifications: [],
      preferences: null,
      scope,
      status: 'loading',
    });
    setActionError(null);
    setIsSaving(false);

    fetchSavingsNotificationInbox({ merchantId: activeMerchantId })
      .then((inbox) => {
        if (!active || scopeRef.current !== scope) return;
        setState({
          error: null,
          notifications: inbox.notifications,
          preferences: inbox.preferences,
          scope,
          status: 'ready',
        });
        const capabilityScope = {
          apiOrigin: EXPO_PUBLIC_API_URL,
          merchantId: activeMerchantId,
          userId: activeUserId,
        };
        // deliveryEnabled is server-global; this device may still have no
        // confirmed token (e.g. the token RPC failed). Only switch to
        // server delivery — and cancel the local reminder — after this
        // user/device registration is confirmed, else the customer gets
        // neither local nor remote reminders.
        void (async () => {
          const registered =
            inbox.deliveryEnabled &&
            (await getRegisteredPushToken(
              activeUserId,
              activeMerchantId
            ).catch(() => null));
          if (!active || scopeRef.current !== scope) return;
          if (registered) {
            await savingsNotificationCapability
              .markAvailable(capabilityScope)
              .then(() => cancelSavingsReminderNotification())
              .catch(() => undefined);
          } else {
            await savingsNotificationCapability
              .clearAvailable(capabilityScope)
              .catch(() => undefined);
          }
        })();
      })
      .catch((error: unknown) => {
        if (!active || scopeRef.current !== scope) return;
        setState({
          error: getErrorMessage(error),
          notifications: [],
          preferences: null,
          scope,
          status: 'ready',
        });
      });

    return () => {
      active = false;
    };
  }, [activeMerchantId, activeUserId, reloadVersion, scope]);

  const markRead = async (notificationId: string) => {
    if (!scope || !activeMerchantId) {
      throw new Error(
        'Savings notifications are unavailable without a merchant.'
      );
    }
    setActionError(null);
    try {
      await markSavingsNotificationRead({
        merchantId: activeMerchantId,
        notificationId,
      });
      if (scopeRef.current !== scope) return;
      setState((current) => ({
        ...current,
        notifications: current.notifications.map((notification) =>
          notification.id === notificationId && notification.readAt === null
            ? { ...notification, readAt: new Date().toISOString() }
            : notification
        ),
      }));
    } catch (error) {
      const message = getErrorMessage(error);
      if (scopeRef.current === scope) setActionError(message);
      throw error;
    }
  };

  const updatePreferences = async (
    preferences: SavingsNotificationPreferencesPatch
  ) => {
    if (!scope || !activeMerchantId) {
      throw new Error(
        'Savings notifications are unavailable without a merchant.'
      );
    }
    setActionError(null);
    setIsSaving(true);
    try {
      await updateSavingsNotificationPreferences({
        merchantId: activeMerchantId,
        preferences,
      });
      if (scopeRef.current !== scope) return;
      setState((current) => ({
        ...current,
        preferences: current.preferences
          ? { ...current.preferences, ...preferences }
          : current.preferences,
      }));
    } catch (error) {
      const message = getErrorMessage(error);
      if (scopeRef.current === scope) setActionError(message);
      throw error;
    } finally {
      if (scopeRef.current === scope) setIsSaving(false);
    }
  };

  return {
    actionError: isCurrentScope ? actionError : null,
    error: isCurrentScope ? state.error : null,
    isLoading:
      Boolean(scope) && (!isCurrentScope || state.status === 'loading'),
    isSaving: isCurrentScope ? isSaving : false,
    markRead,
    notifications: isCurrentScope ? state.notifications : [],
    preferences: isCurrentScope ? state.preferences : null,
    retry: () => setReloadVersion((version) => version + 1),
    updatePreferences,
  };
}
