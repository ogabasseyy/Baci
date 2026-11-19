import { withDeliveredTokens } from './expo-push-retry';
import type {
  NotificationSendResult,
  PushAttemptContext,
} from './expo-push-types';
import type { PushStore } from './push-store';

export function readNotificationType(
  data?: Record<string, unknown>
): string | undefined {
  return typeof data?.type === 'string' ? data.type : undefined;
}

function derivePushAttemptStatus(
  tokenCount: number,
  result: NotificationSendResult
): 'sent' | 'partial_failure' | 'failed' | 'skipped_no_tokens' {
  if (tokenCount === 0) {
    return 'skipped_no_tokens';
  }

  if (result.sent > 0 && result.failed === 0 && result.errors.length === 0) {
    return 'sent';
  }

  if (result.sent > 0) {
    return 'partial_failure';
  }

  return 'failed';
}

const PUSH_ATTEMPT_INSERT_ATTEMPTS = 3;
const PUSH_ATTEMPT_INSERT_RETRY_DELAY_MS = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recordPushAttemptWithStore(
  store: PushStore,
  context: PushAttemptContext
): Promise<void> {
  const notificationType =
    context.notificationType ??
    (typeof context.payload?.type === 'string' ? context.payload.type : null);

  // Persist per-token delivery state: retries read the union of delivered
  // tokens across partial attempts and resend only to the failed subset.
  const deliveredTokens = context.result.succeededTokens ?? [];
  const attemptRow = {
    merchant_id: context.merchantId ?? null,
    user_id: context.userId ?? null,
    app_type: context.appType ?? 'admin',
    channel: context.channel ?? null,
    notification_type: notificationType,
    title: context.title,
    body: context.body,
    payload: withDeliveredTokens(context.payload, deliveredTokens),
    token_count: context.tokenCount,
    sent_count: context.result.sent,
    failed_count: context.result.failed,
    status: derivePushAttemptStatus(context.tokenCount, context.result),
    errors: context.result.errors,
  };

  // A lost attempt row blinds the next retry's exclusion set and duplicates
  // alerts on delivered devices, so transient write failures are retried.
  for (let attempt = 1; ; attempt++) {
    const { error } = await store.insertAttempt(attemptRow);
    if (!error) {
      return;
    }
    if (attempt >= PUSH_ATTEMPT_INSERT_ATTEMPTS) {
      // Last resort: log loudly with enough context for manual
      // reconciliation. The delivery result is intentionally NOT failed
      // here — failing a delivered batch would park it for retry with an
      // empty exclusion set and duplicate alerts on every device, which is
      // worse than a missing log row.
      console.error('Failed to store push attempt:', error, {
        merchantId: context.merchantId ?? null,
        notificationType,
        tokenCount: context.tokenCount,
        deliveredTokenCount: deliveredTokens.length,
      });
      return;
    }
    await sleep(PUSH_ATTEMPT_INSERT_RETRY_DELAY_MS * attempt);
  }
}
