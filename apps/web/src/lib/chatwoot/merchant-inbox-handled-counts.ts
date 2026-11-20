import 'server-only';

import { providerHandledCountSchema } from '@/schemas/merchant-inbox-handled-provider';
import { CHAT_LABEL_AI, CHAT_LABEL_MERCHANT } from './chat-auto-reply-labels';
import type { MerchantInboxBinding } from './merchant-inbox-config';

const REQUEST_TIMEOUT_MS = 8_000;
const MS_PER_DAY = 86_400_000;

export type HandledCounts = {
  handledByAi: number | null;
  handledByMerchant: number | null;
};

async function countLabelled(
  binding: MerchantInboxBinding,
  label: string,
  sinceDate: string
): Promise<number | null> {
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}/conversations/filter`,
    binding.apiOrigin
  );
  try {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        api_access_token: binding.apiAccessToken,
      },
      // The inbox filter comes from the binding, never from the request, so
      // one store cannot count another store's conversations.
      body: JSON.stringify({
        payload: [
          {
            attribute_key: 'inbox_id',
            filter_operator: 'equal_to',
            values: [binding.inboxId],
            query_operator: 'AND',
          },
          {
            attribute_key: 'labels',
            filter_operator: 'equal_to',
            values: [label],
            query_operator: 'AND',
          },
          {
            attribute_key: 'created_at',
            filter_operator: 'is_greater_than',
            values: [sinceDate],
            query_operator: null,
          },
        ],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[merchant-inbox] handled count failed', {
        status: response.status,
      });
      return null;
    }
    const parsed = providerHandledCountSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.meta.all_count : null;
  } catch {
    console.error('[merchant-inbox] handled count failed', { status: null });
    return null;
  }
}

/**
 * How many conversations in the window the assistant answered on its own, and
 * how many a person took over. A failed read is null, not zero, so the card
 * shows a dash instead of claiming nobody was helped.
 */
export async function getHandledCounts(
  binding: MerchantInboxBinding,
  input: { days: number; now: number }
): Promise<HandledCounts> {
  // The provider compares whole dates with a strict "greater than", so start
  // one day earlier: the window is never shorter than requested (it may
  // include the partial day before the cutoff).
  const sinceDate = new Date(input.now - (input.days + 1) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const [handledByAi, handledByMerchant] = await Promise.all([
    countLabelled(binding, CHAT_LABEL_AI, sinceDate),
    countLabelled(binding, CHAT_LABEL_MERCHANT, sinceDate),
  ]);
  return { handledByAi, handledByMerchant };
}
