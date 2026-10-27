import { createHash } from 'node:crypto';
import type { ConversionEvent } from '@/lib/analytics/ad-platform-conversion-event';

export interface ChatgptPaidEvent {
  id: string;
  type: 'order_created';
  timestamp_ms: number;
  source_url: string;
  action_source: 'web';
  oppref?: string;
  opt_out: true;
  user: {
    obref?: string;
    emails_sha256?: string[];
    external_ids_sha256?: string[];
  };
  data: {
    type: 'contents';
    amount: number;
    currency: string;
    contents?: Array<{
      id: string;
      quantity: number;
      amount?: number;
      currency: string;
    }>;
  };
}

export function toChatgptMinorUnits(value: number, currency: string): number {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Intl.supportedValuesOf('currency').includes(currency)
  ) {
    throw new Error('invalid_chatgpt_amount');
  }
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  const amount = Math.round(value * 10 ** (digits ?? 2));
  if (!Number.isSafeInteger(amount)) throw new Error('invalid_chatgpt_amount');
  return amount;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Only the durable paid-order adapter calls this: browser observations never
// become server conversions. Missing consent is deliberately fail-closed.
export function buildChatgptPaidEvent(
  event: ConversionEvent,
  sourceUrl: string
): ChatgptPaidEvent | null {
  if (
    event.source !== 'server' ||
    event.event_type !== 'purchase' ||
    event.user_data.measurement_consent !== true
  )
    return null;
  const origin = new URL(sourceUrl);
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw new Error('invalid_chatgpt_source');
  const timestamp = Date.parse(event.occurred_at ?? '');
  if (!Number.isFinite(timestamp) || !event.event_id.trim())
    throw new Error('invalid_chatgpt_event_identity');
  const currency = event.custom_data.currency?.trim().toUpperCase() ?? '';
  const value = event.custom_data.value;
  if (typeof value !== 'number') throw new Error('invalid_chatgpt_amount');
  const email = event.user_data.email?.trim().toLowerCase();
  const externalId = event.user_data.external_id?.trim();
  return {
    id: event.event_id,
    type: 'order_created',
    timestamp_ms: timestamp,
    source_url: origin.origin,
    action_source: 'web',
    opt_out: true,
    ...(event.user_data.oppref ? { oppref: event.user_data.oppref } : {}),
    user: {
      ...(event.user_data.obref ? { obref: event.user_data.obref } : {}),
      ...(email ? { emails_sha256: [hash(email)] } : {}),
      ...(externalId ? { external_ids_sha256: [hash(externalId)] } : {}),
    },
    data: {
      type: 'contents',
      amount: toChatgptMinorUnits(value, currency),
      currency,
      contents: event.custom_data.contents?.map((item) => {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
          throw new Error('invalid_chatgpt_quantity');
        return {
          id: item.id,
          quantity: item.quantity,
          currency,
          ...(item.price === undefined
            ? {}
            : { amount: toChatgptMinorUnits(item.price, currency) }),
        };
      }),
    },
  };
}
