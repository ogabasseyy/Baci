import { createLogger } from '@/lib/logger';
import { trackNotificationInteraction } from '@/services/analytics';
import {
  clearBadge,
  handleNotificationResponse,
} from '@/services/push-notifications';

type NotificationResponse = import('expo-notifications').NotificationResponse;
type Navigate = (
  screen: string,
  params?: Record<string, string>,
  isCurrent?: () => boolean
) => void | Promise<void>;
type OnHandled = (response: NotificationResponse) => unknown;
type ProcessOptions = { isRetry?: boolean };

const log = createLogger('PushNotificationResponse');
const openedNotificationIds = new Set<string>();
const processingNotificationIds = new Set<string>();
const trackedNotificationIds = new Set<string>();
let latestResponseKey: string | null = null;
const pendingNotificationResponses = new Map<
  string,
  PendingNotificationResponse
>();
const pendingNotificationFinalizations = new Map<
  string,
  PendingNotificationFinalization
>();

const PENDING_RESPONSE_RETRY_DELAY_MS = 250;
const MAX_PENDING_RESPONSE_RETRIES = 120;

type PendingNotificationResponse = {
  response: NotificationResponse;
  navigate: Navigate;
  onHandled?: OnHandled;
  attempts: number;
  retryTimer?: ReturnType<typeof setTimeout>;
};

type PendingNotificationFinalization = {
  response: NotificationResponse;
  onHandled: OnHandled;
  attempts: number;
  retryTimer?: ReturnType<typeof setTimeout>;
};

function getResponseOccurrenceKey(response: NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.notification.date}`;
}

function clearPendingNotificationResponse(responseKey: string): void {
  const pending = pendingNotificationResponses.get(responseKey);
  if (!pending) return;

  if (pending.retryTimer !== undefined) {
    clearTimeout(pending.retryTimer);
  }
  pendingNotificationResponses.delete(responseKey);
}

function schedulePendingNotificationResponse(responseKey: string): void {
  const pending = pendingNotificationResponses.get(responseKey);
  if (!pending || pending.retryTimer !== undefined) return;

  pending.retryTimer = setTimeout(() => {
    const current = pendingNotificationResponses.get(responseKey);
    if (!current) return;
    if (latestResponseKey !== responseKey) {
      clearPendingNotificationResponse(responseKey);
      return;
    }

    current.retryTimer = undefined;
    processPushNotificationResponse(
      current.response,
      current.navigate,
      current.onHandled,
      { isRetry: true }
    );
  }, PENDING_RESPONSE_RETRY_DELAY_MS);
}

function queuePendingNotificationResponse(
  responseKey: string,
  response: NotificationResponse,
  navigate: Navigate,
  onHandled?: OnHandled
): void {
  const pending = pendingNotificationResponses.get(responseKey) ?? {
    response,
    navigate,
    attempts: 0,
  };
  pending.response = response;
  pending.navigate = navigate;
  pending.onHandled = onHandled;
  pending.attempts += 1;

  if (pending.attempts > MAX_PENDING_RESPONSE_RETRIES) {
    pendingNotificationResponses.delete(responseKey);
    log.warn(
      'Giving up on notification response after navigation readiness retries:',
      responseKey
    );
    return;
  }

  pendingNotificationResponses.set(responseKey, pending);
  schedulePendingNotificationResponse(responseKey);
}

function clearPendingNotificationFinalization(responseKey: string): void {
  const pending = pendingNotificationFinalizations.get(responseKey);
  if (pending?.retryTimer !== undefined) clearTimeout(pending.retryTimer);
  pendingNotificationFinalizations.delete(responseKey);
}

function attemptNotificationFinalization(
  responseKey: string,
  response: NotificationResponse,
  onHandled: OnHandled
): void {
  if (latestResponseKey !== responseKey) {
    clearPendingNotificationFinalization(responseKey);
    return;
  }

  try {
    if (onHandled(response) !== false) {
      clearPendingNotificationFinalization(responseKey);
      return;
    }
  } catch (error) {
    clearPendingNotificationFinalization(responseKey);
    log.warn('Failed to finalize notification response:', error);
    return;
  }

  const pending = pendingNotificationFinalizations.get(responseKey) ?? {
    response,
    onHandled,
    attempts: 0,
  };
  pending.attempts += 1;
  if (pending.attempts > MAX_PENDING_RESPONSE_RETRIES) {
    pendingNotificationFinalizations.delete(responseKey);
    log.warn('Giving up on notification response finalization:', responseKey);
    return;
  }
  pendingNotificationFinalizations.set(responseKey, pending);
  pending.retryTimer = setTimeout(() => {
    const current = pendingNotificationFinalizations.get(responseKey);
    if (!current) return;
    current.retryTimer = undefined;
    attemptNotificationFinalization(
      responseKey,
      current.response,
      current.onHandled
    );
  }, PENDING_RESPONSE_RETRY_DELAY_MS);
}

function completeNotificationResponse(
  responseKey: string,
  response: NotificationResponse,
  onHandled?: OnHandled
): void {
  try {
    clearBadge();
  } catch (error) {
    log.warn('Failed to clear notification badge:', error);
  }

  openedNotificationIds.add(responseKey);
  clearPendingNotificationResponse(responseKey);
  if (onHandled)
    attemptNotificationFinalization(responseKey, response, onHandled);
}

export function processPushNotificationResponse(
  response: NotificationResponse,
  navigate: Navigate,
  onHandled?: OnHandled,
  options?: ProcessOptions
): void {
  const content = response.notification.request.content;
  const data = content.data as Record<string, unknown> | undefined;
  const responseKey = getResponseOccurrenceKey(response);

  if (!options?.isRetry && pendingNotificationResponses.has(responseKey)) {
    return;
  }
  if (
    openedNotificationIds.has(responseKey) ||
    processingNotificationIds.has(responseKey)
  ) {
    return;
  }
  if (!options?.isRetry) latestResponseKey = responseKey;
  processingNotificationIds.add(responseKey);
  let awaitsAsyncHandling = false;

  try {
    const notificationId =
      typeof data?.notification_id === 'string'
        ? data.notification_id
        : response.notification.request.identifier;
    const notificationType =
      typeof data?.notification_type === 'string'
        ? data.notification_type
        : typeof data?.type === 'string'
          ? data.type
          : 'unknown';

    try {
      if (!trackedNotificationIds.has(responseKey)) {
        trackNotificationInteraction(
          'opened',
          notificationType,
          notificationId
        );
        trackedNotificationIds.add(responseKey);
      }
    } catch (error) {
      log.warn('Failed to track notification interaction:', error);
    }

    let handlingResult: void | Promise<void>;
    try {
      handlingResult = handleNotificationResponse(response, (screen, params) =>
        navigate(screen, params, () => latestResponseKey === responseKey)
      );
    } catch (error) {
      log.warn('Failed to handle notification response:', error);
      queuePendingNotificationResponse(
        responseKey,
        response,
        navigate,
        onHandled
      );
      return;
    }

    if (handlingResult) {
      awaitsAsyncHandling = true;
      void handlingResult
        .then(() => {
          completeNotificationResponse(responseKey, response, onHandled);
        })
        .catch((error: unknown) => {
          log.warn('Failed to handle notification response:', error);
          queuePendingNotificationResponse(
            responseKey,
            response,
            navigate,
            onHandled
          );
        })
        .finally(() => {
          processingNotificationIds.delete(responseKey);
        });
      return;
    }

    completeNotificationResponse(responseKey, response, onHandled);
  } finally {
    if (!awaitsAsyncHandling) processingNotificationIds.delete(responseKey);
  }
}
