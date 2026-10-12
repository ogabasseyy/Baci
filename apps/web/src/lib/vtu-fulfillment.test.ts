import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fulfillPendingVtuTransaction,
  INSUFFICIENT_WALLET_BALANCE_MESSAGE,
  isInsufficientWalletBalanceError,
  VtuPersistenceError,
} from '@/lib/vtu-fulfillment';

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
  emailClaimData?: { id: string } | null;
  notificationClaimData?: { id: string } | null;
  purchaseUpdateData?: { id: string } | null;
  purchaseUpdateErrors?: Array<{ message: string } | null>;
  updateErrors?: {
    finalMetadata?: { message: string };
    purchase?: { message: string };
    successMetadata?: { message: string };
  };
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
  emailClaimData = { id: 'vtu-1' },
  notificationClaimData = { id: 'vtu-1' },
  purchaseUpdateData = { id: 'vtu-1' },
  purchaseUpdateErrors,
  updateErrors = {},
  updatePayloads = [],
}: PendingTransactionMockOptions): SupabaseStub {
  let purchaseUpdateAttempt = 0;
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
                  columns === 'error_message, metadata, status, transaction_id'
                    ? (currentTransactionData ?? transactionRow)
                    : transactionRow,
                error: null,
              }),
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
              let updateError = selectUpdateError(
                payloadRecord,
                transactionRow,
                updateErrors
              );
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

              const purchaseUpdateMaybeSingle = vi.fn().mockResolvedValue({
                data: updateError ? null : purchaseUpdateData,
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
        const chain = makeMaybeSingleChain(existingCustomerCashbackMaybeSingle);
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
              }
            : null,
          error: null,
        });
      }

      if (name === 'clear_vtu_customer_email_notification_attempt') {
        return Promise.resolve({
          data: {
            ...(transactionRow.metadata &&
            typeof transactionRow.metadata === 'object'
              ? (transactionRow.metadata as Record<string, unknown>)
              : {}),
            [String(args?.p_attempt_key)]: false,
          },
          error: null,
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist VTU transaction metadata:',
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
      error: 'Temporary biller error',
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
        purchase: { message: 'purchase write failed' },
      },
    });

    await expect(
      fulfillPendingVtuTransaction({
        supabase,
        transactionId: 'vtu-1',
      })
    ).rejects.toThrow('Failed to persist VTU purchase result');
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to persist final VTU transaction metadata:',
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
      error: 'Kuda vend failed',
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
      error: 'Monnify business failure',
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
      error: 'Request successful. (biller status: k11)',
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
      error: 'Request successful. (biller status: k11)',
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
      error: 'Loyalty reward vend rejected',
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
      error: 'Loyalty reward vend rejected',
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
    });
    expect(result).toEqual({
      amount: 1000,
      error: 'Kuda rejected the vend',
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

      expect(result).toMatchObject({
        amount: 1000,
        error: 'Vend rejected (biller status: k11)',
        reference: 'VTU-123',
        refundedToWallet: 1000,
        status: 'failed',
      });
      expect(rpcImpl).toHaveBeenCalledWith('refund_customer_wallet_for_vtu', {
        p_amount: 1000,
        p_customer_id: 'customer-1',
        p_description: expect.any(String),
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
        expect.objectContaining({ p_amount: 700 })
      );
      expect(rpcImpl).not.toHaveBeenCalledWith(
        'reverse_vtu_wallet_payment',
        expect.anything()
      );
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
      expect(rpcImpl).toHaveBeenCalledWith(
        'reverse_vtu_wallet_payment',
        expect.objectContaining({ p_vtu_transaction_id: 'vtu-kuda-fail-1' })
      );
      expect(rpcImpl).toHaveBeenCalledWith(
        'refund_customer_wallet_for_vtu',
        expect.objectContaining({ p_amount: 700 })
      );
      // The card portion is what gets returned as fresh credit.
      expect(result).toMatchObject({ refundedToWallet: 700 });
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
          error_message: expect.stringMatching(/Failed to debit VTU wallet/),
          metadata: expect.objectContaining({
            preVendInterruptedAt: expect.any(String),
          }),
        })
      );
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
          metadata: expect.objectContaining({
            preVendInterruptedAt: expect.any(String),
          }),
        })
      );
      expect(mockPurchaseAirtime).not.toHaveBeenCalled();
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

  it('recovers a stranded pre-vend row to marked pending instead of limbo', async () => {
    // The pre-vend restore failed while the database was down, so the
    // row sits processing with no provider reference — the
    // reconciliation claim declines it. Recovery flips it to marked
    // pending (client retry AND cron re-drive it) and reports
    // processing; the next pass re-drives claim → debit → vend.
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
          request_reference: 'VTU-STRANDED',
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
          updated_at: staleAt,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          error_message: 'Reconciliation recovered stranded pre-vend row',
          metadata: {
            walletDebited: true,
            preVendInterruptedAt: staleAt,
          },
          status: 'pending',
          transaction_id: null,
        },
        error: null,
      });
    const updateEq = vi.fn();
    const updateChain = Object.assign(Promise.resolve({ error: null }), {
      eq: updateEq,
    });
    updateEq.mockReturnValue(updateChain);
    const update = vi.fn(() => ({ eq: updateEq }));
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

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        metadata: expect.objectContaining({
          walletDebited: true,
          preVendInterruptedAt: expect.any(String),
        }),
      })
    );
    expect(result).toMatchObject({
      reference: 'VTU-STRANDED',
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
