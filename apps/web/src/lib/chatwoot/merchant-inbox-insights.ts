import 'server-only';

import { providerInboxSummarySchema } from '@/schemas/merchant-inbox-insights-provider';
import type { MerchantInboxInsightDays } from '@/schemas/merchant-inbox-insights-query';
import type { MerchantInboxInsights } from '@/schemas/merchant-inbox-insights-response';
import type { MerchantInboxBinding } from './merchant-inbox-config';

const REQUEST_TIMEOUT_MS = 8_000;
const SECONDS_PER_DAY = 86_400;

/**
 * Reads the bound inbox's conversation totals from the provider's own
 * reporting. The inbox id comes from the merchant's binding, never from the
 * request, so one store cannot read another store's numbers.
 */
export async function getMerchantInboxInsights(
  binding: MerchantInboxBinding,
  input: { days: MerchantInboxInsightDays; now?: number }
): Promise<{ ok: true; insights: MerchantInboxInsights } | { ok: false }> {
  const until = Math.floor((input.now ?? Date.now()) / 1000);
  const url = new URL(
    `/api/v2/accounts/${binding.accountId}/reports/summary`,
    binding.apiOrigin
  );
  url.searchParams.set('type', 'inbox');
  url.searchParams.set('id', String(binding.inboxId));
  url.searchParams.set('since', String(until - input.days * SECONDS_PER_DAY));
  url.searchParams.set('until', String(until));

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        // Reports are administrator-only upstream; an agent token gets a 403.
        api_access_token:
          binding.reportsApiAccessToken ?? binding.apiAccessToken,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Status only: never the token, URL query or response body.
      console.error('[merchant-inbox] insights request failed', {
        status: response.status,
      });
      return { ok: false };
    }
    const parsed = providerInboxSummarySchema.safeParse(await response.json());
    if (!parsed.success) {
      // Field paths only: never the response body, so a fork that renamed a
      // key is diagnosable without logging provider data.
      console.error('[merchant-inbox] insights response unreadable', {
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
      return { ok: false };
    }
    const summary = parsed.data;
    return {
      ok: true,
      insights: {
        days: input.days,
        conversations: summary.conversations_count,
        customerMessages: summary.incoming_messages_count,
        storeReplies: summary.outgoing_messages_count,
        resolved: summary.resolutions_count,
        avgFirstResponseSeconds: summary.avg_first_response_time,
        avgResolutionSeconds: summary.avg_resolution_time,
      },
    };
  } catch {
    console.error('[merchant-inbox] insights request failed', { status: null });
    return { ok: false };
  }
}
