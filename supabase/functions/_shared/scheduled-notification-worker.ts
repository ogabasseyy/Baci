import type { ScheduledNotification } from './scheduled-notification.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_TYPES = ['all', 'specific', 'segment'] as const;
const TARGET_SEGMENTS = ['new', 'active', 'at_risk'] as const;
const CHANNELS = ['in_app', 'banner', 'push'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function isSafeActionUrl(value: string): boolean {
  if (containsControlCharacter(value)) return false;

  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.includes('\\')) return false;
  if (trimmedValue.startsWith('/')) return !trimmedValue.startsWith('//');

  try {
    return new URL(trimmedValue).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseMalformedClaimIdentity(
  value: unknown
): Pick<ScheduledNotification, 'id' | 'delivery_claim_token'> | null {
  const notification = asRecord(value);
  if (
    !notification ||
    typeof notification.id !== 'string' ||
    !UUID_PATTERN.test(notification.id) ||
    typeof notification.delivery_claim_token !== 'string' ||
    !UUID_PATTERN.test(notification.delivery_claim_token)
  ) {
    return null;
  }
  return {
    delivery_claim_token: notification.delivery_claim_token,
    id: notification.id,
  };
}

function parseClaimedNotification(value: unknown): ScheduledNotification {
  const notification = asRecord(value);
  const targetType = notification?.target_type;
  const targetSegment = notification?.target_segment;
  const targetMerchantIds = asStringArray(notification?.target_merchant_ids);
  const channels = asStringArray(notification?.channels);
  if (
    !notification ||
    typeof notification.id !== 'string' ||
    !UUID_PATTERN.test(notification.id) ||
    typeof notification.delivery_claim_token !== 'string' ||
    !UUID_PATTERN.test(notification.delivery_claim_token) ||
    typeof notification.title !== 'string' ||
    notification.title.length < 1 ||
    notification.title.length > 200 ||
    typeof notification.message !== 'string' ||
    notification.message.length < 1 ||
    notification.message.length > 5000 ||
    typeof targetType !== 'string' ||
    !TARGET_TYPES.includes(targetType as (typeof TARGET_TYPES)[number]) ||
    !targetMerchantIds ||
    targetMerchantIds.length > 500 ||
    !targetMerchantIds.every((id) => UUID_PATTERN.test(id)) ||
    !channels ||
    channels.length < 1 ||
    new Set(channels).size !== channels.length ||
    !channels.every((channel) =>
      CHANNELS.includes(channel as (typeof CHANNELS)[number])
    ) ||
    (targetSegment !== null &&
      (typeof targetSegment !== 'string' ||
        !TARGET_SEGMENTS.includes(
          targetSegment as (typeof TARGET_SEGMENTS)[number]
        ))) ||
    (notification.action_url !== null &&
      (typeof notification.action_url !== 'string' ||
        notification.action_url.length > 2048 ||
        !isSafeActionUrl(notification.action_url))) ||
    (notification.expires_at !== null &&
      (typeof notification.expires_at !== 'string' ||
        !Number.isFinite(Date.parse(notification.expires_at)))) ||
    (targetType === 'specific' && targetMerchantIds.length === 0) ||
    (targetType === 'segment' && targetSegment === null) ||
    (targetType === 'all' &&
      (targetMerchantIds.length > 0 || targetSegment !== null))
  ) {
    throw new Error('Claim RPC returned a malformed scheduled notification');
  }
  return {
    action_url: notification.action_url as string | null,
    channels,
    delivery_claim_token: notification.delivery_claim_token,
    expires_at: notification.expires_at as string | null,
    id: notification.id,
    message: notification.message,
    target_merchant_ids: targetMerchantIds,
    target_segment: targetSegment as ScheduledNotification['target_segment'],
    target_type: targetType as ScheduledNotification['target_type'],
    title: notification.title,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function nextRecipientPageCursor(
  merchantIds: string[],
  pageSize: number
): string | null {
  if (pageSize < 1 || merchantIds.length > pageSize) {
    throw new Error('Invalid scheduled notification recipient page');
  }
  return merchantIds.length === pageSize ? (merchantIds.at(-1) ?? null) : null;
}

function isExpoPushToken(token: string): boolean {
  return /^(?:ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

function isExpired(notification: ScheduledNotification): boolean {
  return (
    notification.expires_at !== null &&
    Number.isFinite(Date.parse(notification.expires_at)) &&
    Date.parse(notification.expires_at) <= Date.now()
  );
}

function getExpoTicketFailure(
  tickets: unknown,
  expectedCount: number
): string | null {
  const body = asRecord(tickets);
  const data = body && Array.isArray(body.data) ? body.data : null;
  if (!data || data.length !== expectedCount) {
    return 'Expo returned an invalid push ticket response';
  }
  const errors: string[] = [];
  for (const rawTicket of data) {
    const ticket = asRecord(rawTicket);
    if (ticket?.status === 'ok') continue;
    const details = asRecord(ticket?.details);
    const code = typeof details?.error === 'string' ? details.error : 'unknown';
    errors.push(code);
  }
  return errors.length > 0
    ? `Expo rejected ${errors.length}/${expectedCount} push tickets (${errors.join(', ')})`
    : null;
}

export const scheduledNotificationWorker = {
  asRecord,
  asStringArray,
  chunks,
  getExpoTicketFailure,
  isExpired,
  isExpoPushToken,
  nextRecipientPageCursor,
  parseClaimedNotification,
  parseMalformedClaimIdentity,
};
