import { createHash } from 'node:crypto';
import type { ConversionEvent } from '@/lib/analytics/ad-platform-conversion-event';
export interface XPaidEvent {
  conversion_time: string;
  event_id: string;
  conversion_id: string;
  identifiers: Record<string, string>[];
  value: string;
  price_currency: string;
  number_items: number;
  contents?: Array<{
    content_id: string;
    content_name?: string;
    content_price?: number;
    num_items: number;
  }>;
}
const hash = (input: string) =>
  createHash('sha256').update(input).digest('hex');
export function buildXPaidEvent(
  event: ConversionEvent,
  pixelId: string,
  eventCode: string
): XPaidEvent | null {
  if (
    event.source !== 'server' ||
    event.event_type !== 'purchase' ||
    event.user_data.marketing_consent !== true
  )
    return null;
  if (
    !/^[A-Za-z0-9]{1,64}$/.test(pixelId) ||
    !eventCode.startsWith(`tw-${pixelId}-`) ||
    !/^[A-Za-z0-9]{1,128}$/.test(eventCode.slice(`tw-${pixelId}-`.length))
  )
    throw new Error('invalid_x_event_code');
  const value = event.custom_data.value;
  const currency = event.custom_data.currency?.trim().toUpperCase();
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !currency ||
    !Intl.supportedValuesOf('currency').includes(currency) ||
    !event.event_id ||
    !Number.isFinite(Date.parse(event.occurred_at ?? ''))
  )
    throw new Error('invalid_x_paid_event');
  const identifiers: Record<string, string>[] = [];
  const email = event.user_data.email?.trim().toLowerCase();
  if (email) identifiers.push({ hashed_email: hash(email) });
  const phone = event.user_data.phone?.trim().replace(/[\s()-]/g, '');
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone))
    identifiers.push({ hashed_phone_number: hash(phone) });
  if (event.user_data.twclid)
    identifiers.push({ twclid: event.user_data.twclid });
  if (!identifiers.length) return null;
  const contents = event.custom_data.contents?.map((item) => {
    if (
      !item.id ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      (item.price !== undefined &&
        (!Number.isFinite(item.price) || item.price < 0))
    )
      throw new Error('invalid_x_paid_item');
    return {
      content_id: item.id,
      content_name: item.name,
      content_price: item.price,
      num_items: item.quantity,
    };
  });
  return {
    conversion_time: event.occurred_at as string,
    event_id: eventCode.slice(`tw-${pixelId}-`.length),
    conversion_id: event.event_id,
    identifiers,
    value: String(value),
    price_currency: currency,
    number_items: contents?.reduce((sum, item) => sum + item.num_items, 0) ?? 0,
    ...(contents ? { contents } : {}),
  };
}
