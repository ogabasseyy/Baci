import { vi } from 'vitest';
import type { PendingTransactionMockOptions } from './vtu-fulfillment.test-support-types';

/** The rpc() stand-in: notification/email claims and the failed-retry claim. */
export function createPendingTransactionRpcMock({
  emailClaimData = { id: 'vtu-1' },
  emailClearData = { id: 'vtu-1' },
  emailFinalizeData = { id: 'vtu-1' },
  notificationClaimData = { id: 'vtu-1' },
  retryClaimData = [
    {
      claimed: true,
      claimed_updated_at: '2026-10-16T00:00:00.000Z',
      refusal_reason: null,
    },
  ],
  retryClaimError = null,
  rpcImpl,
  transactionRow,
}: PendingTransactionMockOptions) {
  return vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'claim_vtu_customer_notification_attempt') {
      return Promise.resolve({
        data: notificationClaimData
          ? {
              ...(transactionRow.metadata &&
              typeof transactionRow.metadata === 'object'
                ? (transactionRow.metadata as Record<string, unknown>)
                : {}),
              customerNotificationAttempted: true,
            }
          : null,
        error: null,
      });
    }

    if (name === 'claim_vtu_customer_email_notification_attempt') {
      return Promise.resolve({
        data: emailClaimData
          ? {
              ...(transactionRow.metadata &&
              typeof transactionRow.metadata === 'object'
                ? (transactionRow.metadata as Record<string, unknown>)
                : {}),
              [String(args?.p_attempt_key)]: true,
              [`${String(args?.p_attempt_key)}At`]: '2026-10-15T00:00:00.000Z',
            }
          : null,
        error: null,
      });
    }

    if (name === 'clear_vtu_customer_email_notification_attempt') {
      return Promise.resolve({
        data: emailClearData
          ? {
              ...(transactionRow.metadata &&
              typeof transactionRow.metadata === 'object'
                ? (transactionRow.metadata as Record<string, unknown>)
                : {}),
              [String(args?.p_attempt_key)]: false,
            }
          : null,
        error: null,
      });
    }

    if (name === 'finalize_vtu_customer_email_notification_attempt') {
      return Promise.resolve({
        data: emailFinalizeData
          ? {
              ...(transactionRow.metadata &&
              typeof transactionRow.metadata === 'object'
                ? (transactionRow.metadata as Record<string, unknown>)
                : {}),
              [String(args?.p_attempt_key)]: false,
              [String(args?.p_sent_key)]: Boolean(args?.p_sent),
              ...(args?.p_delivery_outcome === 'unknown'
                ? {
                    [`${String(args?.p_sent_key)}DeliveryOutcome`]: 'unknown',
                  }
                : {}),
            }
          : null,
        error: null,
      });
    }

    if (name === 'claim_failed_vtu_retry') {
      return Promise.resolve({
        data: retryClaimData,
        error: retryClaimError,
      });
    }

    return rpcImpl
      ? rpcImpl(name, args)
      : Promise.resolve({ data: null, error: null });
  });
}
