import type { ExpoPushTicket } from 'expo-server-sdk';
import { chunkArray, SUPABASE_IN_FILTER_CHUNK_SIZE } from '@/lib/chunk-array';
import {
  getPushTokenDeactivationReason,
  shouldDeactivateForInvalidCredentials,
} from '@/lib/push-token-errors';
import type { NotificationSendResult, TicketContext } from './expo-push-types';
import { unknownDeliveryOutcome } from './push-delivery-boundary';
import type { PushStore } from './push-store';

/**
 * Platform-scoped isolation check for InvalidCredentials pruning. Returns
 * only the failing tokens whose platform group passes
 * `shouldDeactivateForInvalidCredentials` — a failure that spans (or
 * dominates) its platform's tokens indicates broken credentials for that
 * platform, not dead tokens.
 */
function selectPrunableInvalidCredentialsTokens(
  failingTokens: string[],
  batchTokens: { token: string; platform?: string | null }[]
): string[] {
  const platformByToken = new Map(
    batchTokens.map((entry) => [entry.token, entry.platform ?? 'unknown'])
  );
  const batchCountByPlatform = new Map<string, number>();
  for (const entry of batchTokens) {
    const platform = entry.platform ?? 'unknown';
    batchCountByPlatform.set(
      platform,
      (batchCountByPlatform.get(platform) ?? 0) + 1
    );
  }

  const failuresByPlatform = new Map<string, string[]>();
  for (const token of failingTokens) {
    const platform = platformByToken.get(token) ?? 'unknown';
    const failures = failuresByPlatform.get(platform) ?? [];
    failures.push(token);
    failuresByPlatform.set(platform, failures);
  }

  const prunable: string[] = [];
  for (const [platform, failures] of failuresByPlatform) {
    if (
      shouldDeactivateForInvalidCredentials(
        failures.length,
        batchCountByPlatform.get(platform) ?? 0
      )
    ) {
      prunable.push(...failures);
    }
  }
  return prunable;
}

export async function processTicketsWithStore(
  tickets: ExpoPushTicket[],
  tokens: { token: string; platform?: string | null }[],
  store: PushStore,
  context?: TicketContext
): Promise<NotificationSendResult> {
  const deliveryUnknown = context?.deliveryUncertain === true;
  let sent = 0;
  let failed = 0;
  const succeededTokens: string[] = [];
  // Aggregate failures by error code so a 200-token send with one broken
  // token logs one actionable line instead of raw per-ticket noise.
  const errorAggregates = new Map<
    string,
    { count: number; sampleMessage: string }
  >();
  const tokensToDeactivate = new Map<string, string[]>();
  const ticketsToStore: Array<{
    ticket_id: string;
    push_token: string;
    merchant_id: string | null;
    user_id: string | null;
    app_type: string;
    channel: string | null;
    notification_type: string | null;
    status: 'pending';
  }> = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === 'ok') {
      sent++;
      succeededTokens.push(tokens[i].token);
      // Store ok tickets for receipt polling (they have a ticket.id)
      ticketsToStore.push({
        ticket_id: ticket.id,
        push_token: tokens[i].token,
        merchant_id: context?.merchantId ?? null,
        user_id: context?.userId ?? null,
        app_type: context?.appType ?? 'admin',
        channel: context?.channel ?? null,
        notification_type: context?.notificationType ?? null,
        status: 'pending',
      });
    } else {
      failed++;
      const errorCode =
        typeof ticket.details?.error === 'string'
          ? ticket.details.error
          : 'UnknownError';
      const aggregate = errorAggregates.get(errorCode);
      if (aggregate) {
        aggregate.count++;
      } else {
        errorAggregates.set(errorCode, {
          count: 1,
          sampleMessage: ticket.message ?? 'No error message provided',
        });
      }
      const deactivationReason = getPushTokenDeactivationReason(errorCode);
      if (deactivationReason) {
        const tokenList = tokensToDeactivate.get(deactivationReason) ?? [];
        tokenList.push(tokens[i].token);
        tokensToDeactivate.set(deactivationReason, tokenList);
      }
    }
  }

  // Widespread InvalidCredentials means broken project credentials, not dead
  // tokens — leave those active (report-only) so pushes resume the moment
  // credentials are fixed. Credentials are scoped per platform (APNs vs FCM)
  // within a batch (each send targets a single app), so isolation is judged
  // against tokens of the SAME platform only: 5 failing iOS tokens in a
  // 100-token mostly-Android batch is still 100% of the iOS credential scope.
  const invalidCredentialsTokens = tokensToDeactivate.get('InvalidCredentials');
  if (invalidCredentialsTokens) {
    const prunable = selectPrunableInvalidCredentialsTokens(
      invalidCredentialsTokens,
      tokens
    );
    if (prunable.length > 0) {
      tokensToDeactivate.set('InvalidCredentials', prunable);
    } else {
      tokensToDeactivate.delete('InvalidCredentials');
    }
    const skipped = invalidCredentialsTokens.length - prunable.length;
    if (skipped > 0) {
      console.warn(
        `[expo-push] InvalidCredentials on ${skipped} token(s) looks like platform-wide credential breakage — tokens left active`
      );
    }
  }

  // Chunk the id list: .in() values ride in the request URL, so a large batch
  // (the update-nudge can surface thousands of dead tokens) would 414.
  const deactivatedCounts = new Map<string, number>();
  for (const [reason, tokenList] of tokensToDeactivate) {
    for (const tokenChunk of chunkArray(
      tokenList,
      SUPABASE_IN_FILTER_CHUNK_SIZE
    )) {
      const { error: deactivateError } = await store.deactivateTokens(
        reason,
        tokenChunk
      );
      if (deactivateError) {
        console.error(
          'Failed to deactivate undeliverable push tokens:',
          deactivateError
        );
      } else {
        deactivatedCounts.set(
          reason,
          (deactivatedCounts.get(reason) ?? 0) + tokenChunk.length
        );
      }
    }
  }

  const errors: string[] = [];
  for (const [code, aggregate] of errorAggregates) {
    const deactivatedCount = deactivatedCounts.get(code) ?? 0;
    const deactivationNote =
      deactivatedCount > 0 ? `, ${deactivatedCount} token(s) deactivated` : '';
    errors.push(
      `${code} (${aggregate.count} failed${deactivationNote}): ${aggregate.sampleMessage}`
    );
  }

  // Store successful tickets for receipt polling
  if (ticketsToStore.length > 0) {
    const { error: insertError } = await store.insertTickets(ticketsToStore);
    if (insertError) {
      console.error('Failed to store push tickets:', insertError);
      errors.push(`Ticket storage failed: ${insertError.message}`);
    }
  }

  // Omit the key when empty so fully-failed batches keep the historical
  // result shape (the field is optional).
  return {
    sent,
    failed,
    errors,
    ...unknownDeliveryOutcome(deliveryUnknown),
    ...(succeededTokens.length > 0 ? { succeededTokens } : {}),
  };
}
