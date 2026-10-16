import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fulfillPendingVtuTransaction,
  INSUFFICIENT_WALLET_BALANCE_MESSAGE,
  isInsufficientWalletBalanceError,
  VtuPersistenceError,
} from '@/lib/vtu-fulfillment';
import {
  VTU_CUSTOMER_FAILURE_MESSAGE,
  VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY,
} from '@/lib/vtu-metadata-fields';

const mockPurchaseAirtime = vi.fn();
const mockPurchaseData = vi.fn();
const mockCheckTransactionStatus = vi.fn();
const mockNotifyCustomer = vi.fn();
const mockPurchaseBill = vi.fn();
const mockSendEmail = vi.fn();
const mockMonnifyPurchaseBill = vi.fn();
const mockMonnifyCheckTransactionStatus = vi.fn();

vi.mock('@/lib/kuda', () => ({
  NetworkProvider: {
    MTN: 'MTN',
    AIRTEL: 'AIRTEL',
    GLO: 'GLO',
    MOBILE_9: '9MOBILE',
  },
  purchaseAirtime: (...args: unknown[]) => mockPurchaseAirtime(...args),
  purchaseData: (...args: unknown[]) => mockPurchaseData(...args),
  formatPhoneNumber: (value: string) => value.replace(/\D/g, ''),
  isValidPhoneNumber: (value: string) => /^0[789][01]\d{8}$/.test(value),
  checkTransactionStatus: (...args: unknown[]) =>
    mockCheckTransactionStatus(...args),
}));

vi.mock('@/lib/kuda-bills', () => ({
  purchaseBill: (...args: unknown[]) => mockPurchaseBill(...args),
}));

vi.mock('@/lib/monnify-bills', () => ({
  purchaseBill: (...args: unknown[]) => mockMonnifyPurchaseBill(...args),
  checkTransactionStatus: (...args: unknown[]) =>
    mockMonnifyCheckTransactionStatus(...args),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyCustomer: (...args: unknown[]) => mockNotifyCustomer(...args),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

type SupabaseStub = Parameters<
  typeof fulfillPendingVtuTransaction
>[0]['supabase'];

interface PendingTransactionMockOptions {
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

function findPayloadWithMetadata(
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

function createPendingTransactionSupabaseMock({
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

describe('fulfillPendingVtuTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPurchaseAirtime.mockReset();
    mockPurchaseData.mockReset();
    mockPurchaseBill.mockReset();
    mockCheckTransactionStatus.mockReset();
    mockCheckTransactionStatus.mockResolvedValue({
      message: 'No token',
      status: 'successful',
    });
    mockNotifyCustomer.mockResolvedValue({ errors: [], failed: 0, sent: 1 });
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue({ success: true });
    mockMonnifyPurchaseBill.mockReset();
    mockMonnifyCheckTransactionStatus.mockReset();
  });

  it('returns the existing success payload without repurchasing', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        awarded: false,
        new_points_balance: 501,
        points_awarded: 1,
        reason: 'already_awarded',
        success: true,
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNotificationAttempted: true,
          customerWalletCredited: true,
          customerNewBalance: 500,
          loyaltyPointsAwarded: true,
          loyaltyPointsBalance: 501,
          loyaltyPointsEarned: 1,
          merchantWalletCredited: true,
        },
        error_message: null,
        merchant_commission: 10,
        customer_cashback: 5,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      error: null,
    });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          };
        }

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ single }),
          }),
        };
      }),
      rpc,
    } as unknown as Parameters<
      typeof fulfillPendingVtuTransaction
    >[0]['supabase'];

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      cashback: { amount: 5, credited: true, newBalance: 500 },
      customerIdentifier: undefined,
      loyaltyPoints: { credited: true, earned: 1, newBalance: 501 },
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(rpc).toHaveBeenCalledWith('award_vtu_airtime_loyalty_points', {
      p_points: 1,
      p_transaction_id: 'vtu-1',
    });
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('backfills missing customer cashback for an already successful transaction', async () => {
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      claimData: null,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1500,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNewBalance: 0,
          customerWalletCredited: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 11.25,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      rpcImpl: (name: string) => {
        if (name === 'credit_customer_wallet') {
          // Regression coverage for Supabase clients that surface a single
          // RPC row instead of an array of rows.
          return Promise.resolve({
            data: { new_balance: 25.75 },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('credit_customer_wallet', {
      p_amount: 11.25,
      p_customer_id: 'customer-1',
      p_description: 'Cashback - Airtime MTN ₦1500',
      p_merchant_id: 'merchant-1',
      p_source_id: 'vtu-1',
      p_source_type: 'vtu_transaction',
    });
    expect(result).toMatchObject({
      cashback: { amount: 11.25, credited: true, newBalance: 25.75 },
      status: 'successful',
    });
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerNewBalance: 25.75,
        customerNotificationAttempted: true,
        customerNotificationSent: true,
        customerWalletCredited: true,
      }),
    });
    expect(mockNotifyCustomer).toHaveBeenCalledWith(
      'user-1',
      'Airtime purchase successful',
      'Your MTN airtime purchase of ₦1,500 was successful. ₦11.25 cashback was credited to your wallet.',
      {
        amount: 1500,
        cashbackAmount: 11.25,
        reference: 'VTU-123',
        transactionId: 'vtu-1',
        type: 'vtu_purchase_success',
        vtuType: 'airtime',
      },
      'orders'
    );
  });

  it('sends a token-ready notification for successful bill purchases with a voucher pin', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      claimData: null,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'successful',
      voucherPin: 'TOKEN-READY-1234',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_vtu_customer_notification_attempt',
      { p_transaction_id: 'vtu-1' }
    );
    expect(mockNotifyCustomer).toHaveBeenCalledWith(
      'user-1',
      'Token ready',
      'Your EKEDC PREPAID electricity token is ready. Tap to view it.',
      expect.objectContaining({
        reference: 'VTU-123',
        transactionId: 'vtu-1',
        type: 'vtu_token_ready',
        utilityType: 'power',
        vtuType: 'electricity',
      }),
      'orders'
    );
  });

  it('sends an email receipt when the generic customer notification was already attempted', async () => {
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: 'user-1',
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
        support_email: 'support@oga.test',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNotificationAttempted: true,
          customerEmailNotificationSent: false,
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'successful',
      voucherPin: 'TOKEN-READY-1234',
    });
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        toName: 'Ada Lovelace',
        subject: 'Your Prepaid Token is Ready - OgaBassey',
        htmlContent: expect.stringContaining(
          'href="https://ogabassey.usebaci.com/"'
        ),
        textContent: expect.stringContaining('TOKEN-READY-1234'),
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      {
        p_attempt_key: 'customerTokenEmailNotificationAttempted',
        p_sent_key: 'customerTokenEmailNotificationSent',
        p_transaction_id: 'vtu-1',
      }
    );
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerNotificationAttempted: true,
        customerTokenEmailNotificationAttempted: true,
        customerTokenEmailNotificationSent: true,
      }),
    });
  });

  it('throws retryable when the settlement merge re-read fails after the email sent', async () => {
    // Codex R103 P2 (reconcile site): the email already went out and
    // its `sent: true` lives only in the dropped merge patch — fail
    // retryable instead of succeeding silently, or the
    // lease-without-marker resends once it expires.
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const supabase = createPendingTransactionSupabaseMock({
        customerData: {
          user_id: 'user-1',
          email: 'buyer@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
        },
        merchantData: {
          business_name: 'OgaBassey',
          slug: 'ogabassey',
          support_email: 'support@oga.test',
        },
        transactionRow: {
          id: 'vtu-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'electricity',
          network_provider: '',
          phone_number: '',
          amount: 1000,
          request_reference: 'VTU-123',
          transaction_id: 'kuda-1',
          status: 'successful',
          metadata: {
            customerNotificationAttempted: true,
            customerEmailNotificationSent: false,
            voucherPin: 'TOKEN-READY-1234',
          },
          error_message: null,
          merchant_commission: 0,
          customer_cashback: 0,
          biller_name: 'EKEDC PREPAID',
          biller_item_code: 'KUD-ELE-EKED-002',
          customer_identifier: '43901766923',
        },
        metadataRereadError: { message: 'read failed' },
      });

      await expect(
        fulfillPendingVtuTransaction({ supabase, transactionId: 'vtu-1' })
      ).rejects.toMatchObject({
        name: 'RetryableVtuError',
        message: expect.stringContaining('re-read failed'),
      });
      // The send happened — this is exactly the drop the throw guards.
      expect(mockSendEmail).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('sends token-ready email after an earlier receipt email for token-backed utilities', async () => {
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
        support_email: 'support@oga.test',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerEmailNotificationSent: true,
          customerReceiptEmailNotificationSent: true,
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Your Prepaid Token is Ready - OgaBassey',
        textContent: expect.stringContaining('TOKEN-READY-1234'),
        to: 'buyer@example.com',
      })
    );
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerReceiptEmailNotificationSent: true,
        customerTokenEmailNotificationAttempted: true,
        customerTokenEmailNotificationSent: true,
      }),
    });
  });

  it('sends pending-token email receipts without consuming the token-ready email claim', async () => {
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: 'user-1',
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
        support_email: 'support@oga.test',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNotificationAttempted: true,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'successful',
    });
    expect(result).not.toHaveProperty('voucherPin');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Receipt for Electricity Purchase - OgaBassey',
        textContent: expect.stringContaining(
          'Token fulfillment is still in progress'
        ),
        to: 'buyer@example.com',
      })
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      {
        p_attempt_key: 'customerReceiptEmailNotificationAttempted',
        p_sent_key: 'customerReceiptEmailNotificationSent',
        p_transaction_id: 'vtu-1',
      }
    );
    expect(updatePayloads).not.toContainEqual({
      metadata: expect.objectContaining({
        customerTokenEmailNotificationAttempted: expect.any(Boolean),
      }),
    });
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerReceiptEmailNotificationAttempted: true,
        customerReceiptEmailNotificationSent: true,
      }),
    });
  });

  it('skips duplicate pending-token receipt emails when the legacy pending sent flag is present', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerPendingTokenEmailNotificationSent: true,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      expect.objectContaining({
        p_attempt_key: 'customerReceiptEmailNotificationAttempted',
        p_sent_key: 'customerReceiptEmailNotificationSent',
      })
    );
  });

  it('reclaims a stuck email claim whose lease expired before the send landed', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNotificationAttempted: true,
          customerReceiptEmailNotificationAttempted: true,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({ status: 'successful' });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      {
        p_attempt_key: 'customerReceiptEmailNotificationAttempted',
        p_sent_key: 'customerReceiptEmailNotificationSent',
        p_transaction_id: 'vtu-1',
      }
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com' })
    );
  });

  it('does not steal a fresh email claim held by a live sender', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNotificationAttempted: true,
          customerReceiptEmailNotificationAttempted: true,
          customerReceiptEmailNotificationAttemptedAt: new Date().toISOString(),
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({ status: 'successful' });
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      expect.objectContaining({
        p_attempt_key: 'customerReceiptEmailNotificationAttempted',
      })
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('durably clears a claimed token email attempt when email delivery fails', async () => {
    const updatePayloads: unknown[] = [];
    mockSendEmail.mockResolvedValueOnce({ success: false });
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updateErrors: {
        successMetadata: { message: 'final metadata write failed' },
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'clear_vtu_customer_email_notification_attempt',
      {
        p_attempt_at: '2026-10-15T00:00:00.000Z',
        p_attempt_key: 'customerTokenEmailNotificationAttempted',
        p_sent_key: 'customerTokenEmailNotificationSent',
        p_transaction_id: 'vtu-1',
      }
    );
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerTokenEmailNotificationAttempted: false,
        customerTokenEmailNotificationSent: false,
      }),
    });
  });

  it('records an uncertain terminal marker when delivery outcome is unknown', async () => {
    // Codex R106 P2: ZeptoMail accepted the send but its response
    // was lost — the email may have landed. Record sent=false AND
    // the unknown marker so automatic retries exclude the row
    // instead of collapsing it into a definite failure.
    const updatePayloads: unknown[] = [];
    mockSendEmail.mockResolvedValueOnce({
      success: false,
      deliveryOutcome: 'unknown',
    });
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerTokenEmailNotificationSent: false,
        customerTokenEmailNotificationSentDeliveryOutcome: 'unknown',
      }),
    });
  });

  it('never re-attempts an email with unknown delivery outcome', async () => {
    // Codex R106 P2: the uncertain marker is terminal for
    // automatic retries — neither the in-flight gate nor the
    // claim pre-check may touch the row again.
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerTokenEmailNotificationSent: false,
          customerTokenEmailNotificationSentDeliveryOutcome: 'unknown',
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      expect.anything()
    );
  });

  it('still sends the token email when the earlier receipt outcome is unknown', async () => {
    // Codex R107 P2: an uncertain receipt must not block the
    // distinct token-ready email once the PIN exists — the state
    // machine sends token (not receipt), and the receipt itself is
    // never retried.
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerReceiptEmailNotificationSent: false,
          customerReceiptEmailNotificationSentDeliveryOutcome: 'unknown',
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      expect.objectContaining({
        p_attempt_key: 'customerTokenEmailNotificationAttempted',
      })
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'claim_vtu_customer_email_notification_attempt',
      expect.objectContaining({
        p_attempt_key: 'customerReceiptEmailNotificationAttempted',
      })
    );
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerTokenEmailNotificationSent: true,
      }),
    });
  });

  it('leaves a reclaimed email lease untouched when our clear is stale', async () => {
    const updatePayloads: unknown[] = [];
    mockSendEmail.mockResolvedValueOnce({ success: false });
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      emailClearData: null,
      merchantData: {
        business_name: 'OgaBassey',
        slug: 'ogabassey',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updateErrors: {
        successMetadata: { message: 'final metadata write failed' },
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'clear_vtu_customer_email_notification_attempt',
      expect.objectContaining({
        p_attempt_at: '2026-10-15T00:00:00.000Z',
      })
    );
    // Neither lease key nor sent-result key may be persisted: the
    // row now belongs to the reclaiming owner, so our merge must not
    // write our stale flag, stamp, or `sent: false` over theirs
    // (Codex R102 P2: that would double-send their email).
    for (const payload of updatePayloads) {
      const metadata = (payload as { metadata?: Record<string, unknown> })
        .metadata;
      if (metadata && typeof metadata === 'object') {
        expect(metadata).not.toHaveProperty(
          'customerTokenEmailNotificationAttempted'
        );
        expect(metadata).not.toHaveProperty(
          'customerTokenEmailNotificationAttemptedAt'
        );
        expect(metadata).not.toHaveProperty(
          'customerTokenEmailNotificationSent'
        );
      }
    }
  });

  it('skips email send when another fulfillment path already claimed delivery', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      customerData: {
        user_id: null,
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      emailClaimData: null,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          voucherPin: 'TOKEN-READY-1234',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns success when successful-transaction metadata cannot be persisted', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const supabase = createPendingTransactionSupabaseMock({
      claimData: null,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1500,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 11.25,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      rpcImpl: (name: string) => {
        if (name === 'credit_customer_wallet') {
          return Promise.resolve({
            data: [{ new_balance: 25.75 }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      updateErrors: {
        successMetadata: { message: 'metadata write failed' },
      },
    });

    try {
      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        amount: 1500,
        cashback: { amount: 11.25, credited: true, newBalance: 25.75 },
        reference: 'VTU-123',
        status: 'successful',
      });
      // CAS-merged write (Codex R82 P2): both attempts fail, the
      // helper gives up without throwing, and the result still
      // returns success (flags re-select the row next cron tick).
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'VTU settlement metadata merge gave up after five attempts:',
        expect.objectContaining({
          error: 'metadata write failed',
          transactionId: 'vtu-1',
        })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('reuses an existing cashback ledger when success metadata was not updated', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      claimData: null,
      existingCustomerCashback: { balance_after: 11.25 },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1500,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-1',
        status: 'successful',
        metadata: {
          customerNotificationAttempted: true,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 11.25,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'credit_customer_wallet',
      expect.anything()
    );
    expect(result).toMatchObject({
      cashback: { amount: 11.25, credited: true, newBalance: 11.25 },
      status: 'successful',
    });
  });

  it('claims a pending transaction, purchases airtime, and credits wallets', async () => {
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          customerNotificationAttempted: true,
        },
        error_message: null,
        merchant_commission: 10,
        customer_cashback: 5,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      rpcImpl: (name: string) => {
        if (name === 'credit_customer_wallet') {
          return Promise.resolve({ data: [{ new_balance: 505 }], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      cashback: { amount: 5, credited: true, newBalance: 505 },
      customerIdentifier: undefined,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(mockPurchaseAirtime).toHaveBeenCalledWith(
      '08012345678',
      1000,
      'MTN',
      'OgaBassey',
      'VTU-123'
    );
  });

  it('awards airtime loyalty points from customer cashback after a new successful purchase', async () => {
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });

    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 15,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      rpcImpl: (name: string) => {
        if (name === 'credit_customer_wallet') {
          return Promise.resolve({ data: [{ new_balance: 515 }], error: null });
        }
        if (name === 'award_vtu_airtime_loyalty_points') {
          return Promise.resolve({
            data: {
              awarded: true,
              new_points_balance: 205,
              points_awarded: 5,
              success: true,
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'award_vtu_airtime_loyalty_points',
      {
        p_points: 5,
        p_transaction_id: 'vtu-1',
      }
    );
    expect(result).toMatchObject({
      loyaltyPoints: { credited: true, earned: 5, newBalance: 205 },
      status: 'successful',
    });
    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        loyaltyPointsAwarded: true,
        loyaltyPointsBalance: 205,
        loyaltyPointsEarned: 5,
      }),
    });
  });

  it('normalizes mobile provider IDs before purchasing airtime', async () => {
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'mtn',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(mockPurchaseAirtime).toHaveBeenCalledWith(
      '08012345678',
      1000,
      'MTN',
      'OgaBassey',
      'VTU-123'
    );
  });

  it('retries a failed transaction only when gateway reconciliation allows it', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt failed',
      status: 'failed',
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-retry-1',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {
          paymentReference: 'VTU-PAYSTACK-123',
        },
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseAirtime).toHaveBeenCalledWith(
      '08012345678',
      1000,
      'MTN',
      'OgaBassey',
      'VTU-123'
    );
  });

  it('does not retry a failed transaction when gateway reconciliation finds success', async () => {
    const updatePayloads: unknown[] = [];
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt succeeded',
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {
          paymentReference: 'VTU-PAYSTACK-123',
        },
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(updatePayloads).toContainEqual({
      error_message: null,
      status: 'successful',
    });
  });

  it('does not treat non-enum database statuses as provider statuses during retry reconciliation', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt succeeded',
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      claimData: null,
      currentTransactionData: {
        error_message: 'Concurrent status is not claimable',
        status: 'completed',
      },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {},
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('does not retry a failed transaction while gateway reconciliation is still processing', async () => {
    const updatePayloads: unknown[] = [];
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt still pending',
      status: 'processing',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {
          paymentReference: 'VTU-PAYSTACK-123',
        },
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 1000,
      error: 'Original utility purchase is still processing with the provider',
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(updatePayloads).toEqual([]);
  });

  it('returns failed with the refunded amount when the retry claim loses to a committed refund', async () => {
    // A refund committed between the pre-check read and the atomic
    // claim: the claim refuses already_refunded, and the retry must
    // report failed-with-refund (re-reading the ledger for the amount)
    // instead of re-vending on restored value.
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt failed',
      status: 'failed',
    });

    const supabase = createPendingTransactionSupabaseMock({
      ledgerReadSequence: [null, { amount: 1000 }],
      retryClaimData: [
        {
          claimed: false,
          claimed_updated_at: null,
          refusal_reason: 'already_refunded',
        },
      ],
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {},
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'checkout',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      refundedToWallet: 1000,
      status: 'failed',
    });
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('returns processing when the retry claim finds the row already moved', async () => {
    // Another writer flipped the row between the read and the claim:
    // poll again instead of vending against a stale snapshot.
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt failed',
      status: 'failed',
    });

    const supabase = createPendingTransactionSupabaseMock({
      retryClaimData: [
        {
          claimed: false,
          claimed_updated_at: null,
          refusal_reason: 'status_moved',
        },
      ],
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {},
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: true,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('throws when the retry claim RPC errors', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Original attempt failed',
      status: 'failed',
    });

    const supabase = createPendingTransactionSupabaseMock({
      retryClaimError: { message: 'claim blew up' },
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {},
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    await expect(
      fulfillPendingVtuTransaction({
        retryFailed: true,
        supabase,
        transactionId: 'vtu-1',
      })
    ).rejects.toThrow(VtuPersistenceError);
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('does not retry a failed transaction when retryFailed is false', async () => {
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'failed',
        metadata: {
          paymentReference: 'VTU-PAYSTACK-123',
        },
        error_message: 'Temporary biller error',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      retryFailed: false,
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
  });

  it('preserves an existing transaction id when a successful purchase omits a new one', async () => {
    const updatePayloads: unknown[] = [];
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'existing-kuda-1',
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        status: 'successful',
        transaction_id: 'existing-kuda-1',
      })
    );
  });

  it('persists customer notification attempt metadata when notification sending fails', async () => {
    const updatePayloads: unknown[] = [];
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });
    mockNotifyCustomer.mockRejectedValueOnce(new Error('push failed'));

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(updatePayloads).toContainEqual({
      metadata: expect.objectContaining({
        customerNotificationAttempted: true,
        customerNotificationSent: false,
        paymentPending: false,
      }),
    });
  });

  it('does not notify when another worker claimed customer notification', async () => {
    const updatePayloads: unknown[] = [];
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      notificationClaimData: null,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updatePayloads,
    });

    await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockNotifyCustomer).not.toHaveBeenCalled();
    const finalMetadataPayload = findPayloadWithMetadata(
      updatePayloads,
      (metadata) => metadata.paymentPending === false
    );
    expect(finalMetadataPayload).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          customerNotificationSent: expect.anything(),
        }),
      })
    );
  });

  it('throws when the purchase result cannot be persisted', async () => {
    // Codex R90 P1: the persist-failure log must not carry the
    // provider body — tx id + provider reference only.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPurchaseAirtime.mockResolvedValue({
      success: false,
      message: 'Provider exploded: meter 9988776655 (k99)',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'failed',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updateErrors: {
        purchase: { message: 'purchase write failed' },
      },
    });

    await expect(
      fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      })
    ).rejects.toThrow('Failed to persist VTU purchase result');
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to persist VTU purchase result:',
      expect.not.objectContaining({
        errorMessage: expect.stringContaining('9988776655'),
      })
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('9988776655');
    errorSpy.mockRestore();
  });

  it('retries provider result persistence when the first update fails', async () => {
    vi.useFakeTimers();
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const updatePayloads: unknown[] = [];
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      purchaseUpdateErrors: [
        { message: 'transient purchase write failed' },
        null,
      ],
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updatePayloads,
    });

    try {
      const resultPromise = fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toMatchObject({
        amount: 1000,
        reference: 'VTU-123',
        status: 'successful',
      });
      const purchasePayloads = updatePayloads.filter(
        (payload): payload is Record<string, unknown> =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as Record<string, unknown>).status === 'successful' &&
          'transaction_id' in payload
      );
      expect(purchasePayloads).toHaveLength(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Retrying VTU purchase result persistence after failed update:',
        expect.objectContaining({
          attempt: 1,
          error: 'transient purchase write failed',
          maxAttempts: 3,
          transactionId: 'vtu-1',
        })
      );
    } finally {
      consoleWarnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('returns success when final success metadata cannot be persisted', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      message: 'ok',
      transactionId: 'kuda-1',
      amount: 1000,
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
      },
      updateErrors: {
        finalMetadata: { message: 'final metadata write failed' },
      },
    });

    try {
      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        amount: 1000,
        reference: 'VTU-123',
        status: 'successful',
      });
      // CAS-merged write (Codex R82 P2): both attempts fail, the
      // helper gives up without throwing, and the vend result still
      // returns success (flags re-select the row next cron tick).
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'VTU settlement metadata merge gave up after five attempts:',
        expect.objectContaining({
          error: 'final metadata write failed',
          transactionId: 'vtu-1',
        })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('backfills a missing electricity token from Kuda bill status', async () => {
    mockPurchaseBill.mockResolvedValue({
      success: true,
      reference: 'VTU-123',
      message: 'ok',
      transactionId: 'kuda-bill-1',
      amount: 500,
      status: 'successful',
    });
    mockCheckTransactionStatus.mockResolvedValue({
      message: 'ok',
      pin: '1234-5678-9012',
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '',
        amount: 500,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      amount: 500,
      reference: 'VTU-123',
      status: 'successful',
      voucherPin: '1234-5678-9012',
    });
    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      'kuda-bill-1',
      'VTU-123'
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'set_vtu_transaction_voucher_pin',
      {
        p_transaction_id: 'vtu-1',
        p_voucher_pin: '1234-5678-9012',
      }
    );
  });

  it('sends metadata.customerPhone to Kuda for bill purchases when phone_number contains the meter', async () => {
    mockPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Request successful',
      transactionId: 'kuda-bill-1',
      amount: 1000,
      status: 'pending',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '43901766923',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: { customerPhone: '08146978921' },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseBill).toHaveBeenCalledWith(
      'KUD-ELE-EKED-002',
      '43901766923',
      1000,
      'OgaBassey',
      'VTU-123',
      '08146978921'
    );
    expect(result).toEqual({
      amount: 1000,
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Request successful',
        status: 'processing',
        transaction_id: 'kuda-bill-1',
      })
    );
  });

  it('routes to Monnify provider client for bill vending when metadata.provider is monnify', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: true,
      reference: 'VTU-123',
      message: 'Transaction Completed Successfully',
      transactionId: 'monnify-bill-1',
      amount: 1000,
      status: 'successful',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
          providerErrorDetail: 'stale Monnify failure detail',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockMonnifyPurchaseBill).toHaveBeenCalledWith(
      'biller1',
      'product1',
      '43901766923',
      1000,
      'OgaBassey',
      'VTU-123',
      '08146978921',
      undefined
    );
    expect(mockPurchaseBill).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          providerErrorDetail: expect.anything(),
        }),
        status: 'successful',
      })
    );
  });

  it('falls back to Kuda airtime when Monnify rejects an airtime vend after payment', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message:
        'Monnify rejected the bill payment request. Please verify the details and try again.',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Amount must be greater than zero',
      amount: 1000,
      status: 'failed',
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      reference: 'VTU-123',
      message: 'Request successful',
      transactionId: 'kuda-airtime-1',
      amount: 1000,
      phoneNumber: '08012345678',
      provider: '9MOBILE',
      status: 'successful',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: '9MOBILE',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: '9MOBILE',
          customerCashbackEnabled: true,
          customerCashbackRate: 50,
          originalMerchantCommission: 25,
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 12.5,
        customer_cashback: 12.5,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockMonnifyPurchaseBill).toHaveBeenCalledWith(
      '9MOBILE',
      '13',
      '08012345678',
      1000,
      'OgaBassey',
      'VTU-123',
      '08012345678',
      undefined
    );
    expect(mockPurchaseAirtime).toHaveBeenCalledWith(
      '08012345678',
      1000,
      '9MOBILE',
      'OgaBassey',
      'VTU-123'
    );
    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        customer_cashback: 11.25,
        error_message: null,
        merchant_commission: 11.25,
        metadata: expect.objectContaining({
          commissionProvider: 'kuda',
          fulfillmentProvider: 'kuda',
          monnifyFallbackError:
            'Monnify API error: 400 Bad Request - Amount must be greater than zero',
          originalMerchantCommission: 22.5,
          originalProvider: 'monnify',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        }),
        platform_commission: 22.5,
        status: 'successful',
        transaction_id: 'kuda-airtime-1',
      })
    );
  });

  it('returns the Kuda fallback failure when the Kuda airtime fallback fails', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message:
        'Monnify rejected the bill payment request. Please verify the details and try again.',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Amount must be greater than zero',
      amount: 100,
      status: 'failed',
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Kuda vend failed',
      amount: 100,
      phoneNumber: '08012345678',
      provider: 'MTN',
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      amount: 100,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Kuda vend failed',
        metadata: expect.objectContaining({
          fulfillmentProvider: 'kuda',
          monnifyFallbackError:
            'Monnify API error: 400 Bad Request - Amount must be greater than zero',
          originalProvider: 'monnify',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        }),
        status: 'failed',
        transaction_id: null,
      })
    );
  });

  it('replaces provider failure text with the fixed customer-safe message', async () => {
    // Codex R89 P1: Kuda/Monnify response bodies (which may contain
    // identifiers) must never reach API responses — the client toasts
    // the error verbatim. The raw text stays persisted server-side
    // for support correlation; telemetry carries only the
    // transaction id and provider, never the body.
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const providerMessage =
      'Insufficient float for merchant 9876543210 (ref KU-998877)';
    mockPurchaseAirtime.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: providerMessage,
      amount: 1000,
      phoneNumber: '08012345678',
      provider: 'MTN',
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'kuda',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({ error_message: providerMessage })
    );
    for (const call of consoleErrorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('9876543210');
      expect(JSON.stringify(call)).not.toContain(providerMessage);
    }
    expect(consoleErrorSpy).toHaveBeenCalledWith('Fresh VTU vend failed:', {
      provider: 'MTN',
      transactionId: 'vtu-1',
    });
    consoleErrorSpy.mockRestore();
  });

  it('preserves pending Kuda fallback state after Monnify terminal airtime rejection', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message:
        'Monnify rejected the bill payment request. Please verify the details and try again.',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Amount must be greater than zero',
      amount: 100,
      status: 'failed',
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      transactionId: 'kuda-airtime-pending-1',
      message: 'Kuda vend pending confirmation',
      amount: 100,
      phoneNumber: '08012345678',
      provider: 'MTN',
      status: 'pending',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      amount: 100,
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Kuda vend pending confirmation',
        metadata: expect.objectContaining({
          fulfillmentProvider: 'kuda',
          monnifyFallbackError:
            'Monnify API error: 400 Bad Request - Amount must be greater than zero',
          originalProvider: 'monnify',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        }),
        status: 'processing',
        transaction_id: 'kuda-airtime-pending-1',
      })
    );
  });

  it('persists processing without refunding when the Kuda response times out', async () => {
    // Codex R102 P1: the timeout may follow Kuda's acceptance — the
    // vend may have landed, so the row stays processing for BILL_TSQ
    // reconciliation instead of failing + refunding on top of value.
    mockPurchaseAirtime.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Kuda ADMIN_PURCHASE_BILL request timed out',
      amount: 100,
      phoneNumber: '08012345678',
      provider: 'MTN',
      status: 'pending',
    });
    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'kuda',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({ status: 'processing' })
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'reverse_vtu_wallet_payment',
      expect.anything()
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.anything()
    );
  });

  it('persists Kuda fallback routing before calling Kuda', async () => {
    // If the final result persist exhausts, the stored row must still
    // route Kuda TSQ by request_reference — otherwise it keeps
    // provider=monnify with no vend reference and strands charged.
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Monnify rejected the bill payment request.',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Amount must be greater than zero',
      amount: 100,
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];
    let markerPersistedAtKudaCall = false;
    mockPurchaseAirtime.mockImplementationOnce(async () => {
      markerPersistedAtKudaCall = updatePayloads.some(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          !('status' in payload) &&
          (
            (payload as { metadata?: unknown }).metadata as Record<
              string,
              unknown
            >
          )?.provider === 'kuda'
      );
      return {
        success: false,
        reference: 'VTU-123',
        message: 'Kuda vend pending confirmation',
        amount: 100,
        phoneNumber: '08012345678',
        provider: 'MTN',
        status: 'pending',
      };
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).toHaveBeenCalledOnce();
    expect(markerPersistedAtKudaCall).toBe(true);
    expect(result).toMatchObject({ reference: 'VTU-123' });
  });

  it('settles the Monnify failure without calling Kuda when the fallback marker write fails', async () => {
    // Fail closed: Kuda must never be called when its routing cannot
    // be recorded — nothing delivered, so the Monnify rejection
    // settles (refund path) instead of stranding charged.
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Monnify rejected the bill payment request.',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Amount must be greater than zero',
      amount: 100,
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updateErrors: {
        finalMetadata: { message: 'marker write unavailable' },
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      amount: 100,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Monnify rejected the bill payment request.',
        metadata: expect.not.objectContaining({
          providerFallback: 'monnify_airtime_to_kuda',
        }),
        status: 'failed',
      })
    );
  });

  it('resolves the current row instead of failing it when the fallback marker loses its race', async () => {
    // Codex R97 P1: this worker paused after its Monnify failure; a
    // replay reclaimed the row and is vending. Recording our stale
    // Monnify failure over THEIR in-flight row would refund while
    // their vend lands (free airtime) — resolve their row instead:
    // no failed persist, no Kuda call, no refund; the client replays
    // onto the progressed row.
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Monnify rejected the bill payment request.',
      providerErrorDetail:
        'Monnify API error: 400 Bad Request - Amount must be greater than zero',
      amount: 100,
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      fallbackMarkerData: null,
      currentTransactionData: {
        error_message: null,
        metadata: {
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        },
        status: 'processing',
        transaction_id: null,
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(
      updatePayloads.filter(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as { status?: unknown }).status === 'failed'
      )
    ).toEqual([]);
  });

  it('does not fall back to Kuda airtime for generic Monnify vend failures', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      reference: 'VTU-123',
      message: 'Monnify business failure',
      amount: 100,
      status: 'failed',
    });
    mockPurchaseAirtime.mockResolvedValue({
      success: true,
      reference: 'VTU-123',
      message: 'Request successful',
      transactionId: 'kuda-airtime-1',
      amount: 100,
      phoneNumber: '08012345678',
      provider: 'MTN',
      status: 'successful',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 100,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'MTN',
          productCode: '13',
          requireValidationRef: false,
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: '08012345678',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      amount: 100,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Monnify business failure',
        metadata: expect.not.objectContaining({
          fulfillmentProvider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        }),
        status: 'failed',
        transaction_id: null,
      })
    );
  });

  it('routes to Monnify status requery and reconciles status successfully when metadata.provider is monnify', async () => {
    mockMonnifyCheckTransactionStatus.mockResolvedValue({
      status: 'successful',
      message: 'success',
      pin: 'token-1234',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'monnify-bill-1',
        status: 'processing',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
          // Monnify requery resolves only by the persisted vendReference.
          monnifyVendReference: 'monnify-vend-1',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockMonnifyCheckTransactionStatus).toHaveBeenCalledWith(
      'monnify-vend-1'
    );
    expect(mockCheckTransactionStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'successful',
      voucherPin: 'token-1234',
    });
  });

  it('leaves a Monnify processing row pending (no requery) when it has no vendReference', async () => {
    // Regression: transactionReference is not requeryable; requerying with it
    // returns "not found" → normalized to failed → wrongful refund. A legacy
    // processing row without monnifyVendReference must stay processing.
    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'monnify-bill-1',
        status: 'processing',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockMonnifyCheckTransactionStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'processing' });
  });

  it('Monnify initial vend timeout/network error returns processing status', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: true,
      status: 'pending',
      message: 'Connection timed out',
      transactionId: 'monnify-bill-2',
      amount: 1000,
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'processing',
    });
  });

  it('restores Monnify transient vend failures to pending so retry/cron re-vends them', async () => {
    const transientError = new Error('Transient vend outcome: timeout');
    transientError.name = 'MonnifyTransientVendError';
    mockMonnifyPurchaseBill.mockRejectedValue(transientError);

    const updatePayloads: unknown[] = [];
    const supabase = createPendingTransactionSupabaseMock({
      updatePayloads,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'processing',
    });
    expect(updatePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          error_message: 'Transient vend outcome: timeout',
          status: 'pending',
          transaction_id: null,
          metadata: expect.objectContaining({
            monnifyTransientVendError: 'Transient vend outcome: timeout',
          }),
        }),
      ])
    );
  });

  it('Monnify transient status error keeps row in processing status', async () => {
    mockMonnifyCheckTransactionStatus.mockRejectedValue(
      new Error('Transient database error')
    );

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'monnify-bill-1',
        status: 'processing',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'processing',
    });
  });

  it('Monnify terminal failure triggers wallet refund-safe failed path', async () => {
    mockMonnifyPurchaseBill.mockResolvedValue({
      success: false,
      status: 'failed',
      message: 'Explicit user failure',
      providerErrorDetail: 'Monnify API error: 400 Bad Request - [redacted]',
      transactionId: 'monnify-bill-3',
      amount: 1000,
    });

    const rpcImpl = vi.fn().mockResolvedValue({ data: null, error: null });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'pending',
        source: 'checkout',
        metadata: {
          provider: 'monnify',
          billerCode: 'biller1',
          productCode: 'product1',
        },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC',
        biller_item_code: null,
        customer_identifier: '43901766923',
      },
      rpcImpl,
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      status: 'failed',
    });
    expect(rpcImpl).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.any(Object)
    );
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Explicit user failure',
        metadata: expect.objectContaining({
          providerErrorDetail:
            'Monnify API error: 400 Bad Request - [redacted]',
        }),
        status: 'failed',
      })
    );
  });

  it('reconciles a processing bill transaction to failed and refunds when Kuda later rejects it', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful. (biller status: k11)',
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-bill-1',
        status: 'processing',
        metadata: {},
        error_message: 'Request successful',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
        source: 'checkout',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      'kuda-bill-1',
      'VTU-123'
    );
    expect(mockPurchaseBill).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({
        p_amount: 1000,
        p_customer_id: 'customer-1',
        p_vtu_transaction_id: 'vtu-1',
      })
    );
    expect(result).toMatchObject({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      refundedToWallet: 1000,
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Request successful. (biller status: k11)',
        status: 'failed',
      })
    );
  });

  it('leaves an actively vending processing row alone until Kuda returns a transaction id', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful. (biller status: k11)',
      status: 'failed',
    });
    const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const supabase = createPendingTransactionSupabaseMock({
      rpcImpl,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'processing',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
        source: 'checkout',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      reference: 'VTU-123',
      status: 'processing',
    });
    expect(mockCheckTransactionStatus).not.toHaveBeenCalled();
    expect(rpcImpl).not.toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.anything()
    );
  });

  it('reconciles a persisted processing bill row by request reference when Kuda returned no transaction id', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful. (biller status: k11)',
      status: 'failed',
    });
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'processing',
        metadata: {},
        error_message: 'Request successful',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
        source: 'checkout',
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseBill).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({
        p_amount: 1000,
        p_customer_id: 'customer-1',
        p_vtu_transaction_id: 'vtu-1',
      })
    );
    expect(result).toMatchObject({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      refundedToWallet: 1000,
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Request successful. (biller status: k11)',
        status: 'failed',
      })
    );
  });

  it('settles a stale flagged row from Kuda provider truth without re-vending', async () => {
    // The claim declines (no transaction_id or message) and pre-vend
    // recovery refuses (flag proves the debit landed), but Kuda TSQ
    // resolves by BillRequestRef — settle from that, never re-vend.
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful',
      status: 'successful',
    });
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'processing',
        metadata: { walletDebited: true },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'checkout',
        updated_at: staleAt,
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(mockPurchaseBill).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
  });

  it('applies Kuda fallback credit correction when a flagged fallback row settles', async () => {
    // The recovered row still carries Monnify-derived commission
    // columns; settling those would misallocate real wallet funds.
    // Same inputs as the inline-path correction test, same corrected
    // outputs (11.25/11.25 off the 22.5 Kuda earning).
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful',
      status: 'successful',
    });
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: '9MOBILE',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'processing',
        metadata: {
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
          fulfillmentProvider: 'kuda',
          originalProvider: 'monnify',
          monnifyFallbackError: 'Monnify API error: 400',
          customerCashbackEnabled: true,
          customerCashbackRate: 50,
          originalMerchantCommission: 25,
          walletDebited: true,
        },
        error_message: null,
        merchant_commission: 12.5,
        customer_cashback: 12.5,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'checkout',
        updated_at: staleAt,
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        customer_cashback: 11.25,
        merchant_commission: 11.25,
        metadata: expect.objectContaining({
          commissionProvider: 'kuda',
          originalMerchantCommission: 22.5,
        }),
        platform_commission: 22.5,
        status: 'successful',
      })
    );
  });

  it('fails and refunds a stale flagged row when Kuda definitively rejects it', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful. (biller status: k11)',
      status: 'failed',
    });
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: null,
        status: 'processing',
        metadata: { walletDebited: true },
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
        source: 'checkout',
        updated_at: staleAt,
      },
      updatePayloads,
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-123'
    );
    expect(mockPurchaseBill).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({
        p_amount: 1000,
        p_customer_id: 'customer-1',
        p_vtu_transaction_id: 'vtu-1',
      })
    );
    expect(result).toMatchObject({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      refundedToWallet: 1000,
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        error_message: 'Request successful. (biller status: k11)',
        status: 'failed',
      })
    );
  });

  it('does not refund when processing reconciliation loses the terminal status claim', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful. (biller status: k11)',
      status: 'failed',
    });
    const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const supabase = createPendingTransactionSupabaseMock({
      currentTransactionData: {
        error_message: null,
        metadata: {
          customerNotificationAttempted: true,
          customerWalletCredited: true,
          customerNewBalance: 1000,
        },
        status: 'successful',
        transaction_id: 'kuda-bill-1',
      },
      purchaseUpdateData: null,
      rpcImpl,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-bill-1',
        status: 'processing',
        metadata: {},
        error_message: 'Request successful',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
        source: 'checkout',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(rpcImpl).not.toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.anything()
    );
    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
  });

  it('settles refreshed fallback credits when a concurrent worker persisted them first', async () => {
    // Overlap: this worker read Monnify-derived credits (12.5/12.5),
    // then worker A persisted the Kuda correction (11.25/11.25) with
    // the terminal status. The re-read must refresh the money columns
    // too, or this worker settles stale amounts that win the ledger.
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful',
      status: 'successful',
    });
    const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const supabase = createPendingTransactionSupabaseMock({
      currentTransactionData: {
        customer_cashback: 11.25,
        error_message: null,
        merchant_commission: 11.25,
        metadata: {
          commissionProvider: 'kuda',
          originalMerchantCommission: 22.5,
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        },
        status: 'successful',
        transaction_id: 'kuda-airtime-1',
      },
      rpcImpl,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: '9MOBILE',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-airtime-1',
        status: 'processing',
        metadata: {
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        },
        error_message: null,
        merchant_commission: 12.5,
        customer_cashback: 12.5,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'checkout',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toMatchObject({
      reference: 'VTU-123',
      status: 'successful',
    });
    expect(rpcImpl).toHaveBeenCalledWith(
      'credit_merchant_wallet',
      expect.objectContaining({ p_amount: 11.25 })
    );
    expect(rpcImpl).toHaveBeenCalledWith(
      'credit_customer_wallet',
      expect.objectContaining({ p_amount: 11.25 })
    );
  });

  it('returns failed when processing reconciliation loses the claim to a non-refundable failed row', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Loyalty reward vend rejected',
      status: 'failed',
    });
    const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const supabase = createPendingTransactionSupabaseMock({
      currentTransactionData: {
        error_message: 'Loyalty reward vend rejected',
        metadata: {},
        status: 'failed',
        transaction_id: 'kuda-loyalty-1',
      },
      purchaseUpdateData: null,
      rpcImpl,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-loyalty-1',
        status: 'processing',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'loyalty_reward',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(rpcImpl).not.toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.anything()
    );
  });

  it('throws a retryable error when a reconciled failure cannot issue the refund', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful. (biller status: k11)',
      status: 'failed',
    });
    const rpcImpl = vi.fn((name: string) =>
      Promise.resolve(
        name === 'refund_customer_wallet_for_vtu'
          ? { data: null, error: { message: 'wallet RPC unavailable' } }
          : { data: null, error: null }
      )
    );

    const supabase = createPendingTransactionSupabaseMock({
      rpcImpl,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'electricity',
        network_provider: '',
        phone_number: '08146978921',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-bill-1',
        status: 'processing',
        metadata: {},
        error_message: 'Request successful',
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: 'EKEDC NG - EKEDC PREPAID',
        biller_item_code: 'KUD-ELE-EKED-002',
        customer_identifier: '43901766923',
        source: 'checkout',
      },
    });

    await expect(
      fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      })
    ).rejects.toMatchObject({
      context: {
        failedMessage: 'Request successful. (biller status: k11)',
        refundedAmount: 0,
        transactionId: 'vtu-1',
      },
      name: 'RetryableVtuError',
    });
    // The reconcile persist flipped the row to failed; the guard must
    // carry the persisted status, not the stale processing snapshot.
    expect(rpcImpl).toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.objectContaining({ p_expected_status: 'failed' })
    );
  });

  it('returns failed when processing reconciliation intentionally skips the wallet refund', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Loyalty reward vend rejected',
      status: 'failed',
    });
    const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const supabase = createPendingTransactionSupabaseMock({
      rpcImpl,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: null,
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-loyalty-1',
        status: 'processing',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'loyalty_reward',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(result).toEqual({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      status: 'failed',
    });
    expect(rpcImpl).not.toHaveBeenCalledWith(
      'refund_customer_wallet_for_vtu',
      expect.anything()
    );
  });

  it('confirms the refund when losing the reconcile claim to an unrefunded failed row', async () => {
    // Replay/cron overlap: the winner persisted failed but hasn't
    // confirmed the refund yet. This terminal response must confirm
    // it — the client rotates the key on 400 and failed rows are
    // cron-excluded, so anything less strands the debit forever.
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Checking status',
      status: 'processing',
    });
    const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const updatePayloads: unknown[] = [];

    const supabase = createPendingTransactionSupabaseMock({
      currentTransactionData: {
        error_message: 'Kuda rejected the vend',
        metadata: {},
        status: 'failed',
        transaction_id: 'kuda-air-1',
      },
      purchaseUpdateData: null,
      rpcImpl,
      updatePayloads,
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-air-1',
        status: 'processing',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'checkout',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(rpcImpl).toHaveBeenCalledWith('refund_customer_wallet_for_vtu', {
      p_customer_id: 'customer-1',
      p_merchant_id: 'merchant-1',
      p_amount: 1000,
      p_vtu_transaction_id: 'vtu-1',
      p_description: expect.stringContaining('Refund for failed'),
      p_expected_status: 'failed',
    });
    expect(result).toEqual({
      amount: 1000,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: 'VTU-123',
      refundedToWallet: 1000,
      status: 'failed',
    });
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ refundIssued: true }),
      })
    );
  });

  it('reconciles a processing airtime transaction with Kuda status', async () => {
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Request successful',
      status: 'successful',
    });

    const supabase = createPendingTransactionSupabaseMock({
      transactionRow: {
        id: 'vtu-1',
        merchant_id: 'merchant-1',
        customer_id: 'customer-1',
        type: 'airtime',
        network_provider: 'MTN',
        phone_number: '08012345678',
        amount: 1000,
        request_reference: 'VTU-123',
        transaction_id: 'kuda-airtime-1',
        status: 'processing',
        metadata: {},
        error_message: null,
        merchant_commission: 0,
        customer_cashback: 0,
        biller_name: null,
        biller_item_code: null,
        customer_identifier: null,
        source: 'checkout',
      },
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      'kuda-airtime-1',
      'VTU-123'
    );
    expect(result).toMatchObject({
      amount: 1000,
      reference: 'VTU-123',
      status: 'successful',
    });
  });

  describe('refund-to-wallet on failed vend', () => {
    const FAILED_ROW_BASE = {
      id: 'vtu-1',
      merchant_id: 'merchant-1',
      customer_id: 'customer-1',
      type: 'electricity' as const,
      network_provider: 'EKEDC NG',
      phone_number: '08012345678',
      amount: 1000,
      request_reference: 'VTU-123',
      transaction_id: 'kuda-ref-1',
      error_message: 'Vend rejected (biller status: k11)',
      merchant_commission: 10,
      customer_cashback: 50,
      biller_name: 'EKEDC NG - EKEDC PREPAID',
      biller_item_code: 'KUD-ELE-EKED-002',
      customer_identifier: '43901766923',
      source: 'checkout' as const,
    };

    it('refunds the customer wallet when an already-failed row is replayed', async () => {
      const updatePayloads: unknown[] = [];
      const rpcImpl = vi.fn((name: string) =>
        Promise.resolve(
          name === 'refund_customer_wallet_for_vtu'
            ? {
                data: [
                  {
                    success: true,
                    new_balance: 1050,
                    transaction_id: 'ledger-1',
                  },
                ],
                error: null,
              }
            : { data: null, error: null }
        )
      );

      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          metadata: { paymentReference: 'VTU-PAYSTACK-123' },
        },
        rpcImpl,
        updatePayloads,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      // Provider text persisted pre-flag: replay fails closed to the
      // fixed customer-safe message (Codex R89 P1), raw stays in DB.
      expect(result).toMatchObject({
        amount: 1000,
        error: VTU_CUSTOMER_FAILURE_MESSAGE,
        reference: 'VTU-123',
        refundedToWallet: 1000,
        status: 'failed',
      });
      expect(rpcImpl).toHaveBeenCalledWith('refund_customer_wallet_for_vtu', {
        p_amount: 1000,
        p_customer_id: 'customer-1',
        p_description: expect.any(String),
        p_expected_status: 'failed',
        p_merchant_id: 'merchant-1',
        p_vtu_transaction_id: 'vtu-1',
      });
      const refundMetadataPayload = findPayloadWithMetadata(
        updatePayloads,
        (metadata) => metadata.refundIssued === true
      );
      expect(refundMetadataPayload?.metadata).toMatchObject({
        refundAmount: 1000,
        refundIssued: true,
      });
    });

    it('replaces unflagged persisted provider text when a failed row is replayed', async () => {
      // Codex R89 P1: pre-flag rows carry provider-authored
      // error_message; replay must fail closed to the fixed message.
      const rpcImpl = vi.fn((name: string) =>
        Promise.resolve(
          name === 'refund_customer_wallet_for_vtu'
            ? {
                data: [
                  {
                    success: true,
                    new_balance: 1050,
                    transaction_id: 'ledger-1',
                  },
                ],
                error: null,
              }
            : { data: null, error: null }
        )
      );
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          error_message: 'Kuda timeout for account 1122334455',
          metadata: { paymentReference: 'VTU-PAYSTACK-123' },
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        error: VTU_CUSTOMER_FAILURE_MESSAGE,
        status: 'failed',
      });
    });

    it('returns flagged first-party text verbatim when a failed row is replayed', async () => {
      // The wallet-race notice is first-party fixed copy: writers flag
      // it safe so replays preserve the top-up signal.
      const firstPartyMessage =
        'Wallet balance changed during checkout — payment refunded.';
      const rpcImpl = vi.fn((name: string) =>
        Promise.resolve(
          name === 'refund_customer_wallet_for_vtu'
            ? {
                data: [
                  {
                    success: true,
                    new_balance: 1050,
                    transaction_id: 'ledger-1',
                  },
                ],
                error: null,
              }
            : { data: null, error: null }
        )
      );
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          error_message: firstPartyMessage,
          metadata: {
            paymentReference: 'VTU-PAYSTACK-123',
            [VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY]: true,
          },
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        error: firstPartyMessage,
        status: 'failed',
      });
    });

    it('marks (never credits) a legacy failed row with no collection evidence', async () => {
      // Money-minting regression (Codex R51 6rqH1I): legacy
      // gateway-init/declined rows never collected — no wallet
      // flag, no ledger redemption, no provider reference, no
      // payment reference, no order link. Crediting those mints
      // unearned wallet funds the cron would spray across every
      // historical failed row. The row is marked skipped
      // (terminally failed, cron-excluded) and returns failed
      // WITHOUT throwing (nothing is retryable). FAILS against
      // pre-fix code (no gate: full-amount card-only refund issued).
      const updatePayloads: unknown[] = [];
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          transaction_id: null,
          status: 'failed',
          metadata: {},
          error_message: 'Gateway initialization failed',
        },
        rpcImpl,
        updatePayloads,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({ status: 'failed' });
      expect(result).not.toHaveProperty('refundedToWallet');
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.any(Object)
      );
      const skippedPayload = findPayloadWithMetadata(
        updatePayloads,
        (metadata) => metadata.refundSkipped === 'no_collection_evidence'
      );
      expect(skippedPayload?.metadata).toMatchObject({
        refundSkipped: 'no_collection_evidence',
      });
      expect(skippedPayload?.metadata).not.toHaveProperty('refundIssued');
    });

    it('refunds (never skips) a failed row with a metadata-linked completed gateway transaction', async () => {
      // Twin of the skip test (Codex R54 6rrFRE): the legacy charge
      // route stored its VTU link in transactions.metadata, left
      // order_id null, and never copied paymentReference onto the
      // VTU row — so a genuinely charged row abandoned before its
      // refund carries no other evidence. Skipping it would strand a
      // paid purchase with no vend and no refund.
      const updatePayloads: unknown[] = [];
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));

      const supabase = createPendingTransactionSupabaseMock({
        completedGatewayTransactions: [{ status: 'completed' }],
        transactionRow: {
          ...FAILED_ROW_BASE,
          transaction_id: null,
          status: 'failed',
          metadata: {},
          error_message: 'Kuda request failed',
        },
        rpcImpl,
        updatePayloads,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.objectContaining({
          p_amount: 1000,
          p_customer_id: 'customer-1',
          p_vtu_transaction_id: 'vtu-1',
        })
      );
      expect(result).toMatchObject({
        refundedToWallet: 1000,
        status: 'failed',
      });
      expect(
        findPayloadWithMetadata(
          updatePayloads,
          (metadata) => metadata.refundSkipped === 'no_collection_evidence'
        )
      ).toBeUndefined();
    });

    it('skips the refund when the row has no customer_id', async () => {
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          customer_id: null,
          status: 'failed',
          metadata: {},
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({ status: 'failed' });
      expect(result).not.toHaveProperty('refundedToWallet');
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('skips the refund for non-checkout sources (e.g. loyalty_reward)', async () => {
      // loyalty_reward, gift, direct, storefront_modal — none of these
      // collect customer money, so there's nothing to refund.
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          source: 'loyalty_reward',
          status: 'failed',
          metadata: {},
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({ status: 'failed' });
      expect(result).not.toHaveProperty('refundedToWallet');
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('refunds checkout-sourced rows even when paymentReference is absent (saved-card path)', async () => {
      // Regression: an earlier draft gated on metadata.paymentReference,
      // but the saved-card charge path stores that on the transactions row
      // only — vtu_transactions.metadata has no paymentReference there.
      // Gating on row.source === 'checkout' covers both flows.
      const rpcImpl = vi.fn((name: string) =>
        Promise.resolve(
          name === 'refund_customer_wallet_for_vtu'
            ? {
                data: [
                  {
                    success: true,
                    new_balance: 1050,
                    transaction_id: 'ledger-saved-card',
                  },
                ],
                error: null,
              }
            : { data: null, error: null }
        )
      );
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          metadata: {}, // saved-card path leaves vtu_transactions.metadata empty
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        refundedToWallet: 1000,
        status: 'failed',
      });
      expect(rpcImpl).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.objectContaining({ p_amount: 1000 })
      );
    });

    it('reports the prior refund without re-calling the RPC when metadata.refundIssued is already true', async () => {
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          metadata: {
            paymentReference: 'VTU-PAYSTACK-123',
            refundIssued: true,
            refundAmount: 1000,
          },
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: false,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        refundedToWallet: 1000,
        status: 'failed',
      });
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('reconstructs the wallet+card total when replaying a hybrid kuda-failure refund', async () => {
      // Codex R103 P2: the hybrid branch persists only the card leg
      // (the history projector sums it with the split wallet leg), so
      // a cached replay must add the wallet leg back — a wallet-only
      // refund would otherwise serialize refundedToWallet: 0.
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const runReplay = async (metadata: Record<string, unknown>) => {
        const supabase = createPendingTransactionSupabaseMock({
          transactionRow: {
            ...FAILED_ROW_BASE,
            status: 'failed',
            metadata,
          },
          rpcImpl,
        });
        return await fulfillPendingVtuTransaction({
          retryFailed: false,
          supabase,
          transactionId: 'vtu-1',
        });
      };

      const walletOnly = await runReplay({
        paymentSplit: { card: 0, wallet: 1000 },
        refundAmount: 0,
        refundContext: 'hybrid_vend_failure',
        refundIssued: true,
      });
      expect(walletOnly).toMatchObject({
        refundedToWallet: 1000,
        status: 'failed',
      });

      const split = await runReplay({
        paymentSplit: { card: 400, wallet: 600 },
        refundAmount: 400,
        refundContext: 'hybrid_vend_failure',
        refundIssued: true,
      });
      expect(split).toMatchObject({
        refundedToWallet: 1000,
        status: 'failed',
      });

      // Other branches persist exactly what was restored: a wallet
      // race with the same split restored only the card leg, so the
      // replay must NOT add the wallet leg back.
      const race = await runReplay({
        paymentSplit: { card: 400, wallet: 600 },
        refundAmount: 400,
        refundContext: 'wallet_race',
        refundIssued: true,
      });
      expect(race).toMatchObject({
        refundedToWallet: 400,
        status: 'failed',
      });
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('refuses to retry a row that has already been refunded (prevents double-credit)', async () => {
      // Once metadata.refundIssued is true, retryFailed must NOT execute a
      // second vend attempt: if it succeeded, the customer would keep both
      // the wallet refund AND the successful vend.
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          metadata: {
            refundIssued: true,
            refundAmount: 1000,
            refundedAt: '2026-05-05T08:00:00.000Z',
          },
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        retryFailed: true, // /api/vtu/checkout/confirm passes this
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        amount: 1000,
        reference: 'VTU-123',
        refundedToWallet: 1000,
        status: 'failed',
      });
      // No reconciliation, no retry, no purchase mock invocation.
      expect(mockCheckTransactionStatus).not.toHaveBeenCalled();
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
      expect(mockPurchaseData).not.toHaveBeenCalled();
      expect(mockPurchaseBill).not.toHaveBeenCalled();
    });

    it('blocks retry via the ledger when refundIssued metadata is missing but a refund row exists', async () => {
      // Models the crash-between-RPC-and-metadata-write case: the wallet
      // was credited in a prior fulfillment, but the metadata update failed
      // so refundIssued !== true on this row. The retry path must consult
      // the ledger and refuse to re-vend.
      const supabaseLedgerSelect = {
        eq: vi.fn(() => supabaseLedgerSelect),
        order: vi.fn(() => supabaseLedgerSelect),
        limit: vi.fn(() => supabaseLedgerSelect),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { amount: 1000 },
          error: null,
        }),
      };
      const transactionRow = {
        ...FAILED_ROW_BASE,
        status: 'failed',
        metadata: {}, // metadata write previously failed; refundIssued absent
      };
      const supabase = {
        from: vi.fn((table: string) => {
          if (table === 'vtu_transactions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: transactionRow,
                    error: null,
                  }),
                })),
              })),
            };
          }
          if (table === 'customer_wallet_transactions') {
            return { select: vi.fn(() => supabaseLedgerSelect) };
          }
          return { select: vi.fn() };
        }),
        rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      } as unknown as SupabaseStub;

      const result = await fulfillPendingVtuTransaction({
        retryFailed: true,
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        amount: 1000,
        refundedToWallet: 1000,
        status: 'failed',
      });
      expect(mockCheckTransactionStatus).not.toHaveBeenCalled();
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
      expect(mockPurchaseBill).not.toHaveBeenCalled();
    });

    it('throws VtuPersistenceError when refund RPC succeeded but metadata persistence fails', async () => {
      // Fail-closed: the wallet was credited, but writing refundIssued=true
      // back to vtu_transactions failed. Returning success here would let a
      // later retry miss the cached flag (and the ledger source-of-truth on
      // the retry path is the second line of defence). Surface the error so
      // the next request retries the metadata write.
      const rpcImpl = vi.fn((name: string) =>
        Promise.resolve(
          name === 'refund_customer_wallet_for_vtu'
            ? {
                data: [
                  {
                    success: true,
                    new_balance: 1050,
                    transaction_id: 'ledger-x',
                  },
                ],
                error: null,
              }
            : { data: null, error: null }
        )
      );
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          metadata: {},
        },
        rpcImpl,
        updateErrors: {
          finalMetadata: { message: 'metadata write failed' },
        },
      });

      await expect(
        fulfillPendingVtuTransaction({
          retryFailed: false,
          supabase,
          transactionId: 'vtu-1',
        })
      ).rejects.toThrow(/Failed to persist VTU refund metadata/);
      // RPC must have been called even though we throw afterwards — the
      // ledger row exists, so the next attempt (via the retryFailed path)
      // will find it.
      expect(rpcImpl).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('hybrid success: wallet is debited BEFORE the Kuda vend, walletDebited persisted', async () => {
      // Phase B.5: when row.metadata.paymentSplit.wallet > 0 and
      // walletDebited isn't set, fulfillment must call
      // redeem_vtu_wallet_payment FIRST, persist walletDebited=true, THEN
      // run executeVtuPurchase. The order matters because if Kuda is
      // called first and the wallet debit later fails, we'd have a
      // successful vend the customer didn't pay full price for.
      const rpcCalls: string[] = [];
      const rpcImpl = vi.fn((name: string) => {
        rpcCalls.push(name);
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: [
              {
                success: true,
                new_balance: 700,
                transaction_id: 'wallet-tx-1',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      // Track Kuda call order: it must come AFTER the wallet RPC.
      let kudaCalledAt: number | undefined;
      mockPurchaseAirtime.mockImplementation(() => {
        kudaCalledAt = rpcCalls.length;
        return Promise.resolve({
          success: true,
          message: 'ok',
          transactionId: 'kuda-1',
          amount: 1000,
          status: 'successful',
        });
      });

      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-h1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-H1',
          transaction_id: null,
          status: 'pending',
          metadata: {
            paymentSplit: { wallet: 300, card: 700 },
          },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
        updatePayloads,
      });

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-h1',
      });

      expect(result).toMatchObject({ status: 'successful', amount: 1000 });
      // Kuda was called AFTER the wallet RPC (index > 0).
      expect(kudaCalledAt).toBeGreaterThan(0);
      expect(rpcCalls.indexOf('redeem_vtu_wallet_payment')).toBeLessThan(
        kudaCalledAt ?? Number.POSITIVE_INFINITY
      );
      // walletDebited persisted.
      const walletDebitedPayload = findPayloadWithMetadata(
        updatePayloads,
        (m) => m.walletDebited === true
      );
      expect(walletDebitedPayload).toBeDefined();
    });

    it('skips wallet debit for non-checkout sources even when paymentSplit is present (defense in depth)', async () => {
      // Schema + prepare gate paymentSplit on source==='checkout', but
      // the fulfillment layer adds a third check at the money-movement
      // boundary. If a non-checkout row somehow carries paymentSplit
      // (legacy data, manual SQL, future bypass), the wallet RPC must
      // NOT fire — the refund helper would skip the row on a vend
      // failure, leaving the customer permanently debited with no
      // recovery path.
      //
      // This test pins ONLY the wallet-debit gate. Whether the vend
      // itself succeeds depends on other concerns (reconciliation
      // path for loyalty rewards, etc.) that are out of scope here.
      const rpcCalls: string[] = [];
      const rpcImpl = vi.fn((name: string) => {
        rpcCalls.push(name);
        return Promise.resolve({ data: null, error: null });
      });
      mockPurchaseAirtime.mockResolvedValueOnce({
        success: true,
        status: 'successful',
        reference: 'KUDA-NC-1',
        pin: null,
      });
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-nc-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-NC-1',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 1000, card: 0 } },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'loyalty_reward',
        },
        rpcImpl,
      });

      await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-nc-1',
      });

      // The wallet RPC must NOT have been called for a non-checkout row,
      // regardless of what else happens in fulfillment downstream.
      expect(rpcCalls).not.toContain('redeem_vtu_wallet_payment');
    });

    it('hybrid wallet-race: redeem raises insufficient_wallet_balance, Kuda is NOT called, card portion is refunded', async () => {
      // Wallet balance dropped between initialize and webhook (concurrent
      // refund / cashback / multi-tab redemption). The RPC raises with
      // MESSAGE='insufficient_wallet_balance'. Compensation: refund the
      // already-charged card portion only — the wallet was never debited
      // so nothing to reverse there.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'insufficient_wallet_balance', code: 'P0001' },
          });
        }
        if (name === 'refund_customer_wallet_for_vtu') {
          return Promise.resolve({
            data: [
              { success: true, new_balance: 1700, transaction_id: 'refund-tx' },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-race-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-RACE-1',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 300, card: 700 } },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-race-1',
      });

      expect(result).toMatchObject({
        status: 'failed',
        refundedToWallet: 700, // card portion only — wallet was never debited
      });
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
      expect(rpcImpl).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.objectContaining({
          p_amount: 700,
          // The row was just claimed (processing) when the race
          // refund runs; the snapshot still reads pending (R115 P1).
          p_expected_status: 'processing',
        })
      );
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'reverse_vtu_wallet_payment',
        expect.anything()
      );
    });

    it('wallet-only race restores to pending when the failed persist exhausts (no refund issued, safe to re-drive)', async () => {
      // Codex R91 P2: card<=0 issues NO refund RPC, so restoring
      // cannot double-run compensation. Without the restore the row
      // strands on processing forever (never-debited strands match
      // no recovery predicate by design, R39).
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'insufficient_wallet_balance', code: 'P0001' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-race-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-RACE-1',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 1000, card: 0 } },
          updated_at: '2026-10-14T20:00:00.000Z',
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
        updateErrors: {
          purchase: { message: 'purchase write failed' },
        },
        updatePayloads,
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-race-1',
        })
      ).rejects.toThrow('Failed to persist wallet-race VTU result');
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
      expect(updatePayloads).toContainEqual({
        error_message:
          'VTU wallet balance changed during checkout; the purchase will resume automatically.',
        metadata: expect.objectContaining({
          customerSafeErrorMessage: true,
          preVendInterruptedAt: expect.any(String),
        }),
        status: 'pending',
      });
    });

    it('hybrid race does NOT restore to pending when the failed persist exhausts (card refund may have issued)', async () => {
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'insufficient_wallet_balance', code: 'P0001' },
          });
        }
        if (name === 'refund_customer_wallet_for_vtu') {
          return Promise.resolve({
            data: [
              { success: true, new_balance: 1700, transaction_id: 'refund-tx' },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-race-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-RACE-1',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 300, card: 700 } },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
        updateErrors: {
          purchase: { message: 'purchase write failed' },
        },
        updatePayloads,
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-race-1',
        })
      ).rejects.toThrow('Failed to persist wallet-race VTU result');
      expect(
        updatePayloads.filter(
          (payload) =>
            typeof payload === 'object' &&
            payload !== null &&
            (payload as Record<string, unknown>).status === 'pending'
        )
      ).toEqual([]);
    });

    it('hybrid replay (post-fact) self-heals when the ledger has a refund row and metadata.refundIssued was lost', async () => {
      // Crash-between-RPC-and-metadata-write specific to the wallet-race
      // path: the card portion was refunded (ledger has the row), but the
      // vtu_transactions UPDATE that should have flipped refundIssued=true
      // failed to persist. On the next replay the post-fact path enters
      // refundVtuToCustomerWallet with default refundContext='kuda_failure'
      // and a row whose metadata still lacks both walletDebited AND
      // refundIssued — formerly this branch threw VtuPersistenceError and
      // pinned the row in a 500 loop. The new behavior: consult the ledger
      // (the source of truth), find the refund, sync metadata, return
      // refundIssued=true so the customer is no longer stuck.
      const refundLedgerMaybeSingle = vi.fn().mockResolvedValue({
        data: { amount: 700 },
        error: null,
      });
      const transactionRow = {
        ...FAILED_ROW_BASE,
        status: 'failed',
        metadata: { paymentSplit: { wallet: 300, card: 700 } },
        // walletDebited absent, refundIssued absent
      };
      const updatePayloads: unknown[] = [];
      const supabase = {
        from: vi.fn((table: string) => {
          if (table === 'vtu_transactions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: transactionRow,
                    error: null,
                  }),
                })),
              })),
              update: vi.fn((payload: unknown) => {
                updatePayloads.push(payload);
                return {
                  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
              }),
            };
          }
          if (table === 'customer_wallet_transactions') {
            const chain = {
              eq: vi.fn(() => chain),
              order: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              maybeSingle: refundLedgerMaybeSingle,
            };
            return { select: vi.fn(() => chain) };
          }
          return { select: vi.fn() };
        }),
        rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      } as unknown as SupabaseStub;

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      });

      expect(result).toMatchObject({
        amount: 1000,
        refundedToWallet: 700,
        status: 'failed',
      });
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'reverse_vtu_wallet_payment',
        expect.anything()
      );
      const persistedMetadata = updatePayloads
        .map((p) =>
          p && typeof p === 'object'
            ? (p as Record<string, unknown>).metadata
            : null
        )
        .find(
          (m) => m && typeof m === 'object' && 'refundIssued' in (m as object)
        ) as Record<string, unknown> | undefined;
      expect(persistedMetadata).toMatchObject({
        refundIssued: true,
        refundAmount: 700,
        refundContext: 'wallet_race',
      });
    });

    it('hybrid replay (post-fact) throws VtuPersistenceError when no ledger refund row exists (genuine invariant violation)', async () => {
      // The state we cannot silently recover from: a hybrid row marked
      // failed, paymentSplit set, walletDebited=false, AND no refund row
      // in the ledger. Means the vend was attempted without the wallet
      // ever being debited AND no compensation was issued — a true
      // upstream bug. Fail closed: throw so the caller's retry mechanism
      // re-runs with a clean slate rather than guessing what to refund.
      const transactionRow = {
        ...FAILED_ROW_BASE,
        status: 'failed',
        metadata: { paymentSplit: { wallet: 300, card: 700 } },
      };
      const supabase = {
        from: vi.fn((table: string) => {
          if (table === 'vtu_transactions') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: transactionRow,
                    error: null,
                  }),
                })),
              })),
            };
          }
          if (table === 'customer_wallet_transactions') {
            const chain = {
              eq: vi.fn(() => chain),
              order: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            };
            return { select: vi.fn(() => chain) };
          }
          return { select: vi.fn() };
        }),
        rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      } as unknown as SupabaseStub;

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-1',
        })
      ).rejects.toThrow(VtuPersistenceError);
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('hybrid Kuda failure after wallet debit: reverses wallet AND refunds card portion (no over-credit)', async () => {
      // Wallet was debited (walletDebited=true), then Kuda rejected the
      // vend. Both legs must be undone:
      //   - reverse_vtu_wallet_payment for paymentSplit.wallet
      //   - refund_customer_wallet_for_vtu for paymentSplit.card
      // Net wallet change for customer = +cardPortion (wallet portion
      // returns to original; card portion is fresh credit). Same outcome
      // as the all-card refund path, just with proper ledger separation.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'reverse_vtu_wallet_payment') {
          return Promise.resolve({
            data: [
              {
                success: true,
                reversed_amount: 300,
                new_balance: 1300,
                reversal_transaction_id: 'rev-tx-1',
              },
            ],
            error: null,
          });
        }
        if (name === 'refund_customer_wallet_for_vtu') {
          return Promise.resolve({
            data: [
              {
                success: true,
                new_balance: 2000,
                transaction_id: 'refund-tx-1',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      // Row already has walletDebited=true (the debit happened on a prior
      // fulfillment pass). Now Kuda fails.
      mockPurchaseAirtime.mockResolvedValue({
        success: false,
        message: 'Vend rejected (biller status: k11)',
        amount: 1000,
        status: 'failed',
      });

      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-kuda-fail-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-KFAIL-1',
          transaction_id: null,
          status: 'pending',
          metadata: {
            paymentSplit: { wallet: 300, card: 700 },
            walletDebited: true,
          },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-kuda-fail-1',
      });

      expect(result).toMatchObject({ status: 'failed' });
      // The purchase persist flipped the row to failed before the
      // refund ran; the snapshot still reads pending (R115 P1).
      expect(rpcImpl).toHaveBeenCalledWith(
        'reverse_vtu_wallet_payment',
        expect.objectContaining({
          p_vtu_transaction_id: 'vtu-kuda-fail-1',
          p_expected_status: 'failed',
        })
      );
      expect(rpcImpl).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.objectContaining({
          p_amount: 700,
          p_expected_status: 'failed',
        })
      );
      // Both legs were reversed, so the response reports the total
      // (Codex R98 P2): card-only reporting claimed refundedToWallet:
      // 700 here and 0 for wallet-only splits.
      expect(result).toMatchObject({ refundedToWallet: 1000 });
    });

    it('wallet-only Kuda failure after wallet debit: reports the full restored amount', async () => {
      // Codex R98 P2: wallet-only splits have card: 0, so card-only
      // reporting serialized refundedToWallet: 0 (or omitted it)
      // even though reverse_vtu_wallet_payment restored the full
      // purchase amount.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'reverse_vtu_wallet_payment') {
          return Promise.resolve({
            data: [
              {
                success: true,
                reversed_amount: 1000,
                new_balance: 2000,
                reversal_transaction_id: 'rev-tx-1',
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      mockPurchaseAirtime.mockResolvedValue({
        success: false,
        message: 'Vend rejected (biller status: k11)',
        amount: 1000,
        status: 'failed',
      });

      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        updatePayloads,
        transactionRow: {
          id: 'vtu-kuda-fail-wo',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-KFAIL-WO',
          transaction_id: null,
          status: 'pending',
          metadata: {
            paymentSplit: { wallet: 1000, card: 0 },
            walletDebited: true,
          },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-kuda-fail-wo',
      });

      expect(result).toMatchObject({
        status: 'failed',
        refundedToWallet: 1000,
      });
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
      // Persisted metadata keeps the card leg only: the history
      // projector sums it with the split's wallet leg, so persisting
      // the total would double-count the restoration there.
      expect(updatePayloads).toContainEqual({
        metadata: expect.objectContaining({ refundAmount: 0 }),
      });
    });

    it('fresh vend failure with unconfirmed wallet reversal throws retryable (key preserved)', async () => {
      // P1: wallet debited, vend rejected, reverse_vtu_wallet_payment
      // transiently fails. Returning failed/400 here would make both
      // clients rotate the idempotency key, so the retry mints a fresh
      // debit while the original charge stands unreversed. Throw
      // RetryableVtuError instead (routes map it to 5xx; clients keep
      // the key and the retry dedupes onto this same row, re-attempting
      // the refund). Mirrors the already-failed replay-path guard.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'reverse_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'connection reset' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      mockPurchaseAirtime.mockResolvedValue({
        success: false,
        message: 'Vend rejected (biller status: k11)',
        amount: 1000,
        status: 'failed',
      });

      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-kuda-fail-unreversed',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-KFAIL-UNREV',
          transaction_id: null,
          status: 'pending',
          metadata: {
            paymentSplit: { wallet: 300, card: 700 },
            walletDebited: true,
          },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-kuda-fail-unreversed',
        })
      ).rejects.toMatchObject({
        context: {
          refundedAmount: 0,
          transactionId: 'vtu-kuda-fail-unreversed',
        },
        name: 'RetryableVtuError',
      });
      expect(rpcImpl).toHaveBeenCalledWith(
        'reverse_vtu_wallet_payment',
        expect.objectContaining({
          p_vtu_transaction_id: 'vtu-kuda-fail-unreversed',
        })
      );
    });

    it('wallet-only insufficient balance: marks failed, does NOT call refund RPC (no card portion to refund)', async () => {
      // paymentSplit { wallet: amount, card: 0 } — wallet-only flow. If
      // the wallet RPC raises, there is no gateway charge to refund.
      // The route should mark the row failed and return 4xx without
      // creating phantom refund ledger rows.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'insufficient_wallet_balance', code: 'P0001' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-walletonly-race',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-WO-1',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 1000, card: 0 } },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
        updatePayloads,
      });

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-walletonly-race',
      });

      expect(result).toMatchObject({ status: 'failed' });
      expect(result).not.toHaveProperty('refundedToWallet');
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
      // Pin: the row.status MUST be persisted as 'failed' with an
      // explanatory error_message — otherwise the row stays in
      // 'pending' forever and the next webhook call re-runs the whole
      // flow.
      expect(updatePayloads).toContainEqual(
        expect.objectContaining({
          status: 'failed',
          error_message: expect.stringMatching(/wallet balance/i),
        })
      );
    });

    it('throws VtuPersistenceError when wallet debit RPC fails with a non-balance error (DB outage etc.)', async () => {
      // P1: a DB connection error / RLS misconfig surfaces as a
      // non-`insufficient_wallet_balance` error. The route MUST throw
      // VtuPersistenceError so the webhook caller retries the whole
      // flow, NOT silently route into the wallet-race compensation.
      // Without this test, a future refactor that swaps the message
      // match for code-equality would silently mis-route DB outages.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'connection terminated', code: '08006' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const supabase = createPendingTransactionSupabaseMock({
        claimData: {
          id: 'vtu-debit-err',
          updated_at: '2026-10-12T00:00:01.000Z',
        },
        transactionRow: {
          id: 'vtu-debit-err',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-DBERR',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 300, card: 700 } },
          error_message: null,
          updated_at: '2026-10-12T00:00:00.000Z',
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-debit-err',
        })
      ).rejects.toThrow(/Failed to debit VTU wallet/);
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });

    it('restores debit-RPC failures to marked pending so retry/cron re-drives them', async () => {
      // Without the restore the row sits processing with no provider
      // reference, which the reconciliation claim declines — debited
      // with no vend or refund, forever.
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'connection terminated', code: '08006' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        updatePayloads,
        claimData: {
          id: 'vtu-debit-restore',
          updated_at: '2026-10-12T00:00:01.000Z',
        },
        transactionRow: {
          id: 'vtu-debit-restore',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-DBRESTORE',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 300, card: 700 } },
          error_message: null,
          updated_at: '2026-10-12T00:00:00.000Z',
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-debit-restore',
        })
      ).rejects.toThrow(/Failed to debit VTU wallet/);
      expect(updatePayloads).toContainEqual(
        expect.objectContaining({
          status: 'pending',
          // Fixed user-safe template: error_message is
          // customer-visible via history, so the raw RPC error
          // ('connection terminated') must NOT be persisted.
          error_message:
            'VTU wallet debit failed; the purchase will resume automatically.',
          metadata: expect.objectContaining({
            preVendInterruptedAt: expect.any(String),
          }),
        })
      );
      for (const payload of updatePayloads) {
        expect(JSON.stringify(payload)).not.toContain('connection terminated');
      }
    });

    it('restores with the post-claim token, not the stale fetch-time token', async () => {
      // R41: the claim bumps updated_at, so the fetch-time token is
      // stale by the time an inline restore runs — comparing against
      // it would match zero rows and strand a pre-debit failure (no
      // ledger entry, so the reconciler never recovers it) in
      // processing forever. FAILS pre-fix (eqs the stale T0).
      const FETCH_TOKEN = '2026-10-12T00:00:00.000Z';
      const CLAIM_TOKEN = '2026-10-12T00:00:01.000Z';
      const rpcImpl = vi.fn((name: string) => {
        if (name === 'redeem_vtu_wallet_payment') {
          return Promise.resolve({
            data: null,
            error: { message: 'connection terminated', code: '08006' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const supabase = createPendingTransactionSupabaseMock({
        claimData: { id: 'vtu-claim-token', updated_at: CLAIM_TOKEN },
        transactionRow: {
          id: 'vtu-claim-token',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-CLAIMTOKEN',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 300, card: 700 } },
          error_message: null,
          updated_at: FETCH_TOKEN,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });
      // Record every updated_at eq across update chains.
      type EqFn = (column: string, value: unknown) => unknown;
      const stub = supabase as unknown as {
        from: (table: string) => {
          update: (payload: unknown) => { eq?: EqFn };
        };
      };
      const origFrom = stub.from;
      const observedTokens: unknown[] = [];
      stub.from = (table: string) => {
        const tableStub = origFrom(table);
        if (table !== 'vtu_transactions') {
          return tableStub;
        }
        const origUpdate = tableStub.update;
        tableStub.update = (payload: unknown) => {
          const chain = origUpdate(payload);
          const origEq = chain.eq;
          if (typeof origEq === 'function') {
            chain.eq = (column: string, value: unknown) => {
              if (column === 'updated_at') {
                observedTokens.push(value);
              }
              return origEq(column, value);
            };
          }
          return chain;
        };
        return tableStub;
      };

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-claim-token',
        })
      ).rejects.toThrow(/Failed to debit VTU wallet/);

      expect(observedTokens).toContain(CLAIM_TOKEN);
      expect(observedTokens).not.toContain(FETCH_TOKEN);
    });

    it('restores walletDebited write failures to marked pending (debit is kept, re-drive short-circuits)', async () => {
      // The debit RPC committed but the flag write failed: restore so
      // the retry re-drives (RPC short-circuits on the ledger row,
      // flag write retried, then vend) instead of stranding a
      // reference-less processing row the claim declines.
      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        updatePayloads,
        updateErrors: { finalMetadata: { message: 'write failed' } },
        claimData: {
          id: 'vtu-debited-restore',
          updated_at: '2026-10-12T00:00:01.000Z',
        },
        transactionRow: {
          id: 'vtu-debited-restore',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-DEBITEDRESTORE',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 1000, card: 0 } },
          error_message: null,
          updated_at: '2026-10-12T00:00:00.000Z',
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-debited-restore',
        })
      ).rejects.toThrow(/Failed to persist walletDebited/);
      // The restore write itself also hits the injected failure
      // (best-effort: logged, original throw preserved) — but the
      // attempt is recorded, proving the path runs.
      expect(updatePayloads).toContainEqual(
        expect.objectContaining({
          status: 'pending',
          // Fixed user-safe template: the raw DB error ('write
          // failed') stays in server logs, never in history-visible
          // error_message.
          error_message:
            'VTU wallet debit confirmation failed; the purchase will resume automatically.',
          metadata: expect.objectContaining({
            preVendInterruptedAt: expect.any(String),
          }),
        })
      );
      for (const payload of updatePayloads) {
        expect(JSON.stringify(payload)).not.toContain('write failed');
      }
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    });

    it('restores submission-marker write failures to marked pending without vending', async () => {
      // The marker must persist BEFORE the first provider call: without
      // it the row is indistinguishable from a submitted-but-unpersisted
      // vend, which must never re-drive. Fail closed (restore + throw)
      // so the next pass retries the marker write, then vends.
      const updatePayloads: unknown[] = [];
      const supabase = createPendingTransactionSupabaseMock({
        updatePayloads,
        updateErrors: { submissionMarker: { message: 'marker write failed' } },
        claimData: {
          id: 'vtu-marker-restore',
          updated_at: '2026-10-12T00:00:01.000Z',
        },
        transactionRow: {
          id: 'vtu-marker-restore',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-MARKERRESTORE',
          transaction_id: null,
          status: 'pending',
          metadata: { paymentSplit: { wallet: 1000, card: 0 } },
          error_message: null,
          updated_at: '2026-10-12T00:00:00.000Z',
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
      });

      await expect(
        fulfillPendingVtuTransaction({
          supabase,
          transactionId: 'vtu-marker-restore',
        })
      ).rejects.toThrow(/Failed to persist provider-submission marker/);
      expect(updatePayloads).toContainEqual(
        expect.objectContaining({
          status: 'pending',
          error_message:
            'VTU purchase confirmation failed; the purchase will resume automatically.',
          metadata: expect.objectContaining({
            preVendInterruptedAt: expect.any(String),
          }),
        })
      );
      for (const payload of updatePayloads) {
        expect(JSON.stringify(payload)).not.toContain('marker write failed');
      }
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    });

    it('restores marker failures with the refreshed CAS token from the debit persist', async () => {
      // Codex R65 6ru4mQ: the debit metadata write advances updated_at
      // via trigger — the marker-failure restore must CAS with the NEW
      // token or it zero-matches and strands the charged row until the
      // 5-minute stale path. The token gate matches ONLY on the
      // refreshed token, so this fails against code that restores
      // with the stale claim token.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const updatePayloads: unknown[] = [];
        const supabase = createPendingTransactionSupabaseMock({
          updatePayloads,
          updateErrors: {
            submissionMarker: { message: 'marker write failed' },
          },
          purchaseUpdateData: {
            id: 'vtu-cas-refresh',
            updated_at: '2026-10-12T00:00:02.000Z',
          },
          expectedRestoreToken: '2026-10-12T00:00:02.000Z',
          claimData: {
            id: 'vtu-cas-refresh',
            updated_at: '2026-10-12T00:00:01.000Z',
          },
          transactionRow: {
            id: 'vtu-cas-refresh',
            merchant_id: 'merchant-1',
            customer_id: 'customer-1',
            type: 'airtime',
            network_provider: 'MTN',
            phone_number: '08012345678',
            amount: 1000,
            request_reference: 'VTU-CASREFRESH',
            transaction_id: null,
            status: 'pending',
            metadata: { paymentSplit: { wallet: 1000, card: 0 } },
            error_message: null,
            updated_at: '2026-10-12T00:00:00.000Z',
            merchant_commission: 10,
            customer_cashback: 0,
            biller_name: null,
            biller_item_code: null,
            customer_identifier: null,
            source: 'checkout',
          },
        });

        await expect(
          fulfillPendingVtuTransaction({
            supabase,
            transactionId: 'vtu-cas-refresh',
          })
        ).rejects.toThrow(/Failed to persist provider-submission marker/);
        // Restore attempted AND matched (no lost-race skip).
        expect(updatePayloads).toContainEqual(
          expect.objectContaining({ status: 'pending' })
        );
        expect(warnSpy).not.toHaveBeenCalledWith(
          'VTU pre-vend restore skipped: row changed after snapshot:',
          expect.anything()
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('skips redeem RPC when walletDebited is already true and proceeds to vend', async () => {
      // P1: walletDebited=true means a prior fulfillment pass already
      // completed the debit. The current request must NOT re-call the
      // RPC (it would idempotent-no-op anyway, but the metadata flag
      // saves a round-trip and pins the contract that the gate works).
      const rpcImpl = vi.fn(() => Promise.resolve({ data: null, error: null }));
      mockPurchaseAirtime.mockResolvedValue({
        success: true,
        message: 'ok',
        transactionId: 'kuda-skip',
        amount: 1000,
        status: 'successful',
      });

      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          id: 'vtu-skip-debit',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-SKIP',
          transaction_id: null,
          status: 'pending',
          metadata: {
            paymentSplit: { wallet: 300, card: 700 },
            walletDebited: true,
          },
          error_message: null,
          merchant_commission: 10,
          customer_cashback: 0,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
        },
        rpcImpl,
      });

      const result = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-skip-debit',
      });

      expect(result).toMatchObject({ status: 'successful' });
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'redeem_vtu_wallet_payment',
        expect.anything()
      );
      expect(mockPurchaseAirtime).toHaveBeenCalled();
    });

    it('throws a retryable error when an already-failed checkout row still cannot be refunded', async () => {
      const rpcImpl = vi.fn((name: string) =>
        Promise.resolve(
          name === 'refund_customer_wallet_for_vtu'
            ? { data: null, error: { message: 'database is down' } }
            : { data: null, error: null }
        )
      );
      const supabase = createPendingTransactionSupabaseMock({
        transactionRow: {
          ...FAILED_ROW_BASE,
          status: 'failed',
          metadata: { paymentReference: 'VTU-PAYSTACK-123' },
        },
        rpcImpl,
      });

      await expect(
        fulfillPendingVtuTransaction({
          retryFailed: false,
          supabase,
          transactionId: 'vtu-1',
        })
      ).rejects.toMatchObject({
        context: {
          refundedAmount: 0,
          transactionId: 'vtu-1',
        },
        name: 'RetryableVtuError',
      });
      expect(rpcImpl).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.anything()
      );
    });
  });

  function buildStrandedRowSupabase(
    ledgerData: unknown,
    options: {
      createdAt?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const rowMetadata = options.metadata ?? {
      paymentSplit: { wallet: 1000, card: 0 },
    };
    const single = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'vtu-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-STRANDED',
          transaction_id: null,
          status: 'processing',
          metadata: rowMetadata,
          error_message: null,
          merchant_commission: null,
          customer_cashback: null,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
          created_at: options.createdAt ?? '2026-10-01T00:00:00.000Z',
          updated_at: staleAt,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          error_message: null,
          metadata: rowMetadata,
          status: 'processing',
          transaction_id: null,
        },
        error: null,
      });
    const updateEq = vi.fn();
    const updateMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'vtu-1' }, error: null });
    const updateChain = Object.assign(Promise.resolve({ error: null }), {
      eq: updateEq,
      select: vi.fn(() => ({ maybeSingle: updateMaybeSingle })),
    });
    updateEq.mockReturnValue(updateChain);
    const update = vi.fn(() => ({ eq: updateEq }));
    const ledgerChain = {
      eq: vi.fn(() => ledgerChain),
      limit: vi.fn(() => ledgerChain),
      maybeSingle: vi.fn().mockResolvedValue({ data: ledgerData, error: null }),
      order: vi.fn(() => ledgerChain),
    };
    const rpc = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customer_wallet_transactions') {
          return { select: vi.fn(() => ledgerChain) };
        }
        if (table !== 'vtu_transactions') {
          throw new Error(`Unexpected table: ${table}`);
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single })),
          })),
          update,
        };
      }),
      rpc,
    } as unknown as Parameters<
      typeof fulfillPendingVtuTransaction
    >[0]['supabase'];
    return { supabase, update, rpc };
  }

  it('recovers a debited stranded pre-vend row to marked pending instead of limbo', async () => {
    // The pre-vend restore failed while the database was down, so the
    // row sits processing with no provider reference — the
    // reconciliation claim declines it. The ledger proves a debit
    // landed (money moved → duty to complete), so recovery flips it
    // to marked pending (client retry AND cron re-drive it) and
    // reports processing; the next pass re-drives claim → debit
    // (idempotent, cached) → vend.
    const { supabase, update } = buildStrandedRowSupabase({
      id: 'ledger-debit-1',
    });

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        metadata: expect.objectContaining({
          preVendInterruptedAt: expect.any(String),
        }),
      })
    );
    expect(result).toMatchObject({
      reference: 'VTU-STRANDED',
      status: 'processing',
    });
  });

  it('recovers an unsubmitted prepared row to marked pending instead of requery limbo', async () => {
    // Crash between the debit persist and the first provider call
    // (Codex R50 6rp7M_): walletDebited is set but no submission
    // marker exists on a stale marker-era row, which proves no
    // provider call ran. Recovery flips to marked pending so the
    // next pass re-drives with the same reference (debit
    // short-circuits idempotently) instead of requerying a
    // never-submitted reference as unknown forever. FAILS against
    // pre-fix code (no unsubmitted branch: the row takes the flagged
    // requery path and no flip is issued).
    const { supabase, update } = buildStrandedRowSupabase(
      { id: 'ledger-debit-1' },
      {
        metadata: { submissionMarkerEra: true, walletDebited: true },
      }
    );

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        error_message: expect.stringContaining('unsubmitted prepared row'),
        status: 'pending',
        metadata: expect.objectContaining({
          preVendInterruptedAt: expect.any(String),
        }),
      })
    );
    expect(mockCheckTransactionStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reference: 'VTU-STRANDED',
      status: 'processing',
    });
  });

  it('recovers a marked unsubmitted Monnify row to marked pending instead of stranding it', async () => {
    // Crash between the marker persist and the provider call
    // (Codex R54 6rrFRC): the marker fails the unsubmitted proof
    // and Monnify cannot requery without a response vendReference,
    // so without this branch the row strands processing forever.
    // Recovery flips to marked pending; the next pass re-drives
    // with the same reference (Monnify receives it as its
    // vendReference — the transient path's dedupe assumption).
    // FAILS against pre-fix code (no marked-Monnify branch: the
    // row falls through to resolve-current with no flip issued).
    const { supabase, update } = buildStrandedRowSupabase(
      { id: 'ledger-debit-1' },
      {
        metadata: {
          provider: 'monnify',
          providerSubmissionStartedAt: new Date().toISOString(),
          walletDebited: true,
        },
      }
    );

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        error_message: expect.stringContaining('marked unsubmitted Monnify'),
        status: 'pending',
        metadata: expect.objectContaining({
          preVendInterruptedAt: expect.any(String),
        }),
      })
    );
    expect(mockCheckTransactionStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reference: 'VTU-STRANDED',
      status: 'processing',
    });
  });

  it('never flips a never-debited strand: it may be an exhausted terminal decline', async () => {
    // Joint-outage regression (Codex R39 rldXK): the debit RPC
    // reported insufficient balance, then the marker AND the
    // failed-persist writes all exhausted — the row left behind is
    // byte-identical to a crash strand. No post-decision write can
    // close this, so recovery fails closed on the ledger read: no
    // debit → no flip, no vend — even though the wallet could fund
    // later. The row stays processing (visible, support-recoverable)
    // instead of auto-vending a rejected purchase with no submission.
    // FAILS against pre-fix code (which flips unconditionally).
    const { supabase, update, rpc } = buildStrandedRowSupabase(null);

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'redeem_vtu_wallet_payment',
      expect.anything()
    );
    expect(result).toMatchObject({
      reference: 'VTU-STRANDED',
      status: 'processing',
    });
  });

  it('never re-vends a flagged row; inconclusive requery stays processing', async () => {
    // Post-vend persistence failure (vend returned, result write
    // exhausted): same reference-less processing shape, but the
    // persisted walletDebited flag proves the debit landed, so the
    // row settles from provider truth instead of stranding forever —
    // and never re-vends (double-credit). Ambiguous provider evidence
    // settles nothing: no writes, still processing, retried next pass.
    mockCheckTransactionStatus.mockResolvedValueOnce({
      message: 'Bill not found',
      status: 'unknown',
    });
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const single = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'vtu-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-POSTVEND',
          transaction_id: null,
          status: 'processing',
          metadata: { walletDebited: true },
          error_message: null,
          merchant_commission: null,
          customer_cashback: null,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
          created_at: '2026-10-01T00:00:00.000Z',
          updated_at: staleAt,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          error_message: null,
          metadata: { walletDebited: true },
          status: 'processing',
          transaction_id: null,
        },
        error: null,
      });
    const update = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'vtu_transactions') {
          throw new Error(`Unexpected table: ${table}`);
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single })),
          })),
          update,
        };
      }),
      rpc: vi.fn(),
    } as unknown as Parameters<
      typeof fulfillPendingVtuTransaction
    >[0]['supabase'];

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(mockCheckTransactionStatus).toHaveBeenCalledWith(
      undefined,
      'VTU-POSTVEND'
    );
    expect(mockPurchaseAirtime).not.toHaveBeenCalled();
    expect(mockPurchaseBill).not.toHaveBeenCalled();
    expect(mockMonnifyPurchaseBill).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reference: 'VTU-POSTVEND',
      status: 'processing',
    });
  });

  it('leaves a fresh reference-less processing row to the live worker', async () => {
    // Same shape but written seconds ago: a worker may be mid-vend,
    // so no flip — just report current state.
    const freshAt = new Date(Date.now() - 1000).toISOString();
    const single = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'vtu-1',
          merchant_id: 'merchant-1',
          customer_id: 'customer-1',
          type: 'airtime',
          network_provider: 'MTN',
          phone_number: '08012345678',
          amount: 1000,
          request_reference: 'VTU-LIVE',
          transaction_id: null,
          status: 'processing',
          metadata: {},
          error_message: null,
          merchant_commission: null,
          customer_cashback: null,
          biller_name: null,
          biller_item_code: null,
          customer_identifier: null,
          source: 'checkout',
          created_at: '2026-10-01T00:00:00.000Z',
          updated_at: freshAt,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          error_message: null,
          metadata: {},
          status: 'processing',
          transaction_id: null,
        },
        error: null,
      });
    const update = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'vtu_transactions') {
          throw new Error(`Unexpected table: ${table}`);
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single })),
          })),
          update,
        };
      }),
      rpc: vi.fn(),
    } as unknown as Parameters<
      typeof fulfillPendingVtuTransaction
    >[0]['supabase'];

    const result = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: 'vtu-1',
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reference: 'VTU-LIVE',
      status: 'processing',
    });
  });
});

// The wallet-race compensation hinges on isInsufficientWalletBalanceError
// correctly identifying the migration's contract message. Pin both the
// strict-equality and the wrapped-message branches: the latter exists
// because some supabase-js versions surface PG errors with extra
// context (e.g. "ERROR: insufficient_wallet_balance\nWHERE: ...").
// A future bump that silently changes the wrapping would otherwise
// route every wallet-race into the non-balance VtuPersistenceError
// branch, leaving the customer's card-portion never refunded.
describe('isInsufficientWalletBalanceError', () => {
  it('matches the strict-equality form', () => {
    expect(
      isInsufficientWalletBalanceError({
        message: INSUFFICIENT_WALLET_BALANCE_MESSAGE,
      })
    ).toBe(true);
  });

  it('matches a wrapped P0001 message that contains the contract string', () => {
    expect(
      isInsufficientWalletBalanceError({
        code: 'P0001',
        message: `ERROR: ${INSUFFICIENT_WALLET_BALANCE_MESSAGE}\nWHERE: PL/pgSQL function`,
      })
    ).toBe(true);
  });

  it('does NOT match a non-P0001 error that happens to contain the string', () => {
    expect(
      isInsufficientWalletBalanceError({
        code: '23505',
        message: `something insufficient_wallet_balance unrelated`,
      })
    ).toBe(false);
  });

  it('does NOT match arbitrary errors', () => {
    expect(
      isInsufficientWalletBalanceError({ message: 'some other error' })
    ).toBe(false);
    expect(isInsufficientWalletBalanceError(null)).toBe(false);
    expect(isInsufficientWalletBalanceError(undefined)).toBe(false);
  });
});
