import { vi } from 'vitest';
import type { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';

/**
 * Supabase stand-in for fulfillPendingVtuTransaction tests, shared by the
 * colocated suites (moved out of vtu-fulfillment.test.ts).
 */
export type SupabaseStub = Parameters<
  typeof fulfillPendingVtuTransaction
>[0]['supabase'];

export interface PendingTransactionMockOptions {
  customerData?: {
    user_id: string | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  currentTransactionData?: Record<string, unknown> | null;
  existingCustomerCashback?: { balance_after: number } | null;
  existingMerchantCommission?: { id: string } | null;
  transactionRow: Record<string, unknown>;
  rpcImpl?: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>;
  merchantData?: {
    business_name?: string;
    slug?: string | null;
    support_email?: string | null;
  };
  claimData?: Record<string, unknown> | null;
  completedGatewayTransactions?: Array<{ status: string }>;
  emailClaimData?: { id: string } | null;
  /**
   * When null, the email-clear RPC resolves null (Codex R97 P2: the row
   * was reclaimed under a newer lease generation, so our stale clear
   * must leave the owner's lease untouched).
   */
  emailClearData?: { id: string } | null;
  /**
   * When null, the email-finalize RPC resolves null (Codex R127 P2:
   * same stale-generation semantics as the fenced clear — our merge
   * must revert the outcome keys too).
   */
  emailFinalizeData?: { id: string } | null;
  notificationClaimData?: { id: string } | null;
  purchaseUpdateData?: { id: string; updated_at?: string } | null;
  purchaseUpdateErrors?: Array<{ message: string } | null>;
  /**
   * When set, the Kuda-fallback marker write resolves with this
   * matched row (null = zero-match lost race, Codex R97 P1); all
   * other updates keep purchaseUpdateData. Lets one test lose the
   * fallback race while the claim/debit/marker succeed.
   */
  fallbackMarkerData?: { id: string } | null;
  /**
   * When set, pre-vend restore updates resolve as a CAS match ONLY
   * when the captured `updated_at` token equals this (Codex R65
   * 6ru4mQ) — otherwise they zero-match like a raced row.
   */
  expectedRestoreToken?: string;
  updateErrors?: {
    finalMetadata?: { message: string };
    purchase?: { message: string };
    submissionMarker?: { message: string };
    successMetadata?: { message: string };
  };
  /**
   * When set, the settlement-metadata merge re-read (the only
   * `metadata, updated_at` select) fails with this error (Codex
   * R103 P2) — every other select is unaffected.
   */
  metadataRereadError?: { message: string };
  /**
   * Rows returned by the claim_failed_vtu_retry RPC (Codex R114).
   * Defaults to a successful claim so existing retry tests keep
   * vending; script a refusal to test the lost-race paths.
   */
  retryClaimData?: Record<string, unknown>[] | null;
  retryClaimError?: { message: string } | null;
  /**
   * When set, customer_wallet_transactions reads serve this sequence
   * (then repeat the last) instead of existingCustomerCashback —
   * models a refund landing between the retry pre-check and the
   * post-claim re-read (Codex R114).
   */
  ledgerReadSequence?: ({ amount: number } | null)[];
  updatePayloads?: unknown[];
}

type PendingTransactionUpdateErrors = NonNullable<
  PendingTransactionMockOptions['updateErrors']
>;
type PendingTransactionUpdateError =
  PendingTransactionUpdateErrors[keyof PendingTransactionUpdateErrors];

function selectUpdateError(
  payloadRecord: Record<string, unknown>,
  transactionRow: Record<string, unknown>,
  updateErrors: NonNullable<PendingTransactionMockOptions['updateErrors']>
): PendingTransactionUpdateError {
  if (
    payloadRecord.status === 'successful' ||
    payloadRecord.status === 'failed'
  ) {
    return updateErrors.purchase;
  }

  if (transactionRow.status === 'successful') {
    return updateErrors.successMetadata;
  }

  return updateErrors.finalMetadata;
}

function isSubmissionMarkerShaped(payloadRecord: Record<string, unknown>) {
  const markerMetadata =
    payloadRecord.metadata && typeof payloadRecord.metadata === 'object'
      ? (payloadRecord.metadata as Record<string, unknown>)
      : null;
  return (
    !('status' in payloadRecord) &&
    !('transaction_id' in payloadRecord) &&
    !('error_message' in payloadRecord) &&
    markerMetadata !== null &&
    'providerSubmissionStartedAt' in markerMetadata
  );
}

function isClaimOrErrorUpdate(payloadRecord: Record<string, unknown>): boolean {
  return (
    payloadRecord.status === 'processing' ||
    ('error_message' in payloadRecord && !('metadata' in payloadRecord))
  );
}

function createAwaitableUpdateChain<T>(
  result: T,
  maybeSingle: ReturnType<typeof vi.fn>
) {
  const chain = Promise.resolve(result) as Promise<T> & {
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.maybeSingle = maybeSingle;
  chain.select = vi.fn(() => chain);
  return chain;
}

export function findPayloadWithMetadata(
  payloads: unknown[],
  predicate: (metadata: Record<string, unknown>) => boolean
): { metadata: Record<string, unknown> } | undefined {
  return payloads.find(
    (payload): payload is { metadata: Record<string, unknown> } => {
      if (typeof payload !== 'object' || payload === null) {
        return false;
      }
      const metadata = (payload as { metadata?: unknown }).metadata;
      return (
        typeof metadata === 'object' &&
        metadata !== null &&
        predicate(metadata as Record<string, unknown>)
      );
    }
  );
}

export function createPendingTransactionSupabaseMock({
  customerData = { user_id: 'user-1' },
  currentTransactionData,
  existingCustomerCashback = null,
  existingMerchantCommission = null,
  transactionRow,
  rpcImpl,
  merchantData = { business_name: 'OgaBassey' },
  claimData = { id: 'vtu-1' },
  completedGatewayTransactions = [],
  emailClaimData = { id: 'vtu-1' },
  emailClearData = { id: 'vtu-1' },
  emailFinalizeData = { id: 'vtu-1' },
  notificationClaimData = { id: 'vtu-1' },
  purchaseUpdateData = { id: 'vtu-1' },
  purchaseUpdateErrors,
  fallbackMarkerData,
  expectedRestoreToken,
  updateErrors = {},
  updatePayloads = [],
  metadataRereadError,
  retryClaimData = [
    {
      claimed: true,
      claimed_updated_at: '2026-10-16T00:00:00.000Z',
      refusal_reason: null,
    },
  ],
  retryClaimError = null,
  ledgerReadSequence,
}: PendingTransactionMockOptions): SupabaseStub {
  let ledgerReadIndex = 0;
  let purchaseUpdateAttempt = 0;
  // The first marker-shaped write always takes the submissionMarker
  // slot (unscripted → success: the normal pre-vend marker). Later
  // ones take it only while a scripted error stands AND the write is
  // non-terminal: the marker write retries (R79: 3 attempts), so
  // failing only the first would let the retry succeed and the test
  // would vend instead of restoring. Terminal (post-vend)
  // marker-shaped writes and unscripted runs fall through to
  // finalMetadata, preserving tests that script a failure for a
  // post-vend metadata write.
  let submissionMarkerWriteSeen = false;
  const claimMaybeSingle = vi.fn().mockResolvedValue({
    data: claimData,
    error: null,
  });
  const merchantSingle = vi.fn().mockResolvedValue({
    data: merchantData,
    error: null,
  });
  const customerMaybeSingle = vi.fn().mockResolvedValue({
    data: customerData,
    error: null,
  });
  const existingCustomerCashbackMaybeSingle = vi.fn().mockResolvedValue({
    data: existingCustomerCashback,
    error: null,
  });
  const existingMerchantCommissionMaybeSingle = vi.fn().mockResolvedValue({
    data: existingMerchantCommission,
    error: null,
  });
  const notificationClaimMaybeSingle = vi.fn().mockResolvedValue({
    data: notificationClaimData,
    error: null,
  });
  const makeMaybeSingleChain = (maybeSingle: ReturnType<typeof vi.fn>) => {
    const chain = {
      eq: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle,
      order: vi.fn(() => chain),
      select: vi.fn(() => chain),
    };
    return chain;
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'vtu_transactions') {
        return {
          select: vi.fn((columns?: string) => ({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data:
                  columns === 'error_message, status' ||
                  columns ===
                    'customer_cashback, error_message, merchant_commission, metadata, status, transaction_id' ||
                  // Pre-refresh re-read shape: kept so the
                  // concurrent-settlement regression test fails
                  // against code that does not refresh money columns.
                  columns === 'error_message, metadata, status, transaction_id'
                    ? (currentTransactionData ?? transactionRow)
                    : transactionRow,
                error: null,
              }),
              // Marker read-back verify (Codex R54 6rrFRC): the
              // scripted marker write truly failed, so the re-read
              // shows no marker — the error (and the caller's
              // restore+throw) stands. The settlement merge
              // re-read (Codex R103 P2) fails when scripted.
              maybeSingle: vi.fn().mockResolvedValue(
                columns === 'metadata, updated_at' && metadataRereadError
                  ? { data: null, error: metadataRereadError }
                  : {
                      data: {
                        metadata:
                          transactionRow.metadata &&
                          typeof transactionRow.metadata === 'object'
                            ? transactionRow.metadata
                            : {},
                        status: 'processing',
                        transaction_id: transactionRow.transaction_id ?? null,
                      },
                      error: null,
                    }
              ),
            }),
          })),
          update: vi.fn((payload: unknown) => {
            updatePayloads.push(payload);
            const payloadRecord =
              payload && typeof payload === 'object'
                ? (payload as Record<string, unknown>)
                : {};
            const metadataPayload =
              payloadRecord.metadata &&
              typeof payloadRecord.metadata === 'object'
                ? (payloadRecord.metadata as Record<string, unknown>)
                : null;
            const isNotificationClaim =
              metadataPayload?.customerNotificationAttempted === true &&
              !('customerNotificationSent' in metadataPayload) &&
              !('paymentPending' in metadataPayload) &&
              !('status' in payloadRecord);
            const isRetryReconciliation =
              payloadRecord.status === 'successful' &&
              payloadRecord.error_message === null &&
              !('metadata' in payloadRecord) &&
              !('transaction_id' in payloadRecord);

            if (isNotificationClaim) {
              const notificationClaimChain = {
                eq: vi.fn(() => notificationClaimChain),
                maybeSingle: notificationClaimMaybeSingle,
                or: vi.fn(() => notificationClaimChain),
                select: vi.fn(() => notificationClaimChain),
              };
              return notificationClaimChain;
            }

            if (isRetryReconciliation) {
              const retryReconciliationChain = {
                eq: vi.fn(() => retryReconciliationChain),
                maybeSingle: claimMaybeSingle,
                select: vi.fn(() => retryReconciliationChain),
              };
              return retryReconciliationChain;
            }

            if (!isClaimOrErrorUpdate(payloadRecord)) {
              if (
                expectedRestoreToken !== undefined &&
                payloadRecord.status === 'pending' &&
                typeof metadataPayload?.preVendInterruptedAt === 'string'
              ) {
                // Token-gated pre-vend restore: captures the CAS
                // token from the eq chain and matches only on the
                // expected value (Codex R65 6ru4mQ).
                let capturedToken: unknown;
                const restoreChain = createAwaitableUpdateChain(
                  { data: null, error: null },
                  vi.fn()
                );
                restoreChain.eq = vi.fn((column: string, value: unknown) => {
                  if (column === 'updated_at') {
                    capturedToken = value;
                  }
                  return restoreChain;
                });
                restoreChain.maybeSingle = vi.fn().mockImplementation(() =>
                  Promise.resolve({
                    data:
                      capturedToken === expectedRestoreToken
                        ? { id: 'vtu-1' }
                        : null,
                    error: null,
                  })
                );
                return restoreChain;
              }
              let updateError = selectUpdateError(
                payloadRecord,
                transactionRow,
                updateErrors
              );
              if (isSubmissionMarkerShaped(payloadRecord)) {
                const terminalWrite =
                  payloadRecord.status === 'successful' ||
                  payloadRecord.status === 'failed';
                if (
                  !submissionMarkerWriteSeen ||
                  (updateErrors.submissionMarker !== undefined &&
                    !terminalWrite)
                ) {
                  updateError = updateErrors.submissionMarker;
                }
                submissionMarkerWriteSeen = true;
              }
              if (
                (payloadRecord.status === 'successful' ||
                  payloadRecord.status === 'failed') &&
                purchaseUpdateErrors &&
                purchaseUpdateErrors.length > 0
              ) {
                const errorIndex = Math.min(
                  purchaseUpdateAttempt,
                  purchaseUpdateErrors.length - 1
                );
                updateError = purchaseUpdateErrors[errorIndex] ?? undefined;
                purchaseUpdateAttempt += 1;
              }

              const isFallbackMarker =
                !('status' in payloadRecord) &&
                metadataPayload?.providerFallback === 'monnify_airtime_to_kuda';
              const purchaseUpdateMaybeSingle = vi.fn().mockResolvedValue({
                data: updateError
                  ? null
                  : isFallbackMarker && fallbackMarkerData !== undefined
                    ? fallbackMarkerData
                    : purchaseUpdateData,
                error: updateError ?? null,
              });
              return createAwaitableUpdateChain(
                {
                  data: null,
                  error: updateError ?? null,
                },
                purchaseUpdateMaybeSingle
              );
            }

            return createAwaitableUpdateChain(
              { data: null, error: null },
              claimMaybeSingle
            );
          }),
        };
      }

      if (table === 'customer_wallet_transactions') {
        const ledgerMaybeSingle = ledgerReadSequence
          ? vi.fn().mockImplementation(() => {
              const row =
                ledgerReadSequence[
                  Math.min(ledgerReadIndex, ledgerReadSequence.length - 1)
                ];
              ledgerReadIndex += 1;
              return Promise.resolve({ data: row, error: null });
            })
          : existingCustomerCashbackMaybeSingle;
        const chain = makeMaybeSingleChain(ledgerMaybeSingle);
        return {
          select: vi.fn(() => chain),
        };
      }

      if (table === 'wallet_transactions') {
        const chain = makeMaybeSingleChain(
          existingMerchantCommissionMaybeSingle
        );
        return {
          select: vi.fn(() => chain),
        };
      }

      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle }),
          }),
        };
      }

      if (table === 'transactions') {
        // Refund-gate evidence lookups: awaitable terminal (no
        // maybeSingle), one scripted payload per test. Defaults to
        // no gateway rows — genuinely-charged legacy rows opt in.
        const terminal = Object.assign(
          Promise.resolve({
            data: completedGatewayTransactions,
            error: null,
          }),
          { eq: vi.fn(() => terminal) }
        );
        return { select: vi.fn(() => ({ eq: terminal.eq })) };
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: merchantSingle }),
        }),
      };
    }),
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
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
                [`${String(args?.p_attempt_key)}At`]:
                  '2026-10-15T00:00:00.000Z',
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
    }),
  } as unknown as SupabaseStub;
}
