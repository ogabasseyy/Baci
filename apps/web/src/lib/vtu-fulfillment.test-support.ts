import { vi } from 'vitest';
import { createPendingTransactionRpcMock } from './vtu-fulfillment.test-support-rpc';
import type {
  PendingTransactionMockOptions,
  SupabaseStub,
} from './vtu-fulfillment.test-support-types';
import { createVtuTransactionUpdateMock } from './vtu-fulfillment.test-support-update';

export { findPayloadWithMetadata } from './vtu-fulfillment.test-support-payloads';
export type {
  PendingTransactionMockOptions,
  SupabaseStub,
} from './vtu-fulfillment.test-support-types';

/**
 * Supabase stand-in for fulfillPendingVtuTransaction tests, shared by the
 * colocated suites. The update() and rpc() handlers live in their own
 * test-support modules.
 */
export function createPendingTransactionSupabaseMock(
  options: PendingTransactionMockOptions
): SupabaseStub {
  const {
    customerData = { user_id: 'user-1' },
    currentTransactionData,
    existingCustomerCashback = null,
    existingMerchantCommission = null,
    transactionRow,
    merchantData = { business_name: 'OgaBassey' },
    claimData = { id: 'vtu-1' },
    completedGatewayTransactions = [],
    notificationClaimData = { id: 'vtu-1' },
    metadataRereadError,
    ledgerReadSequence,
  } = options;
  let ledgerReadIndex = 0;
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

  // Built once per mock so its counters (purchase attempts, marker writes)
  // persist across every from('vtu_transactions') call.
  const vtuTransactionUpdate = createVtuTransactionUpdateMock({
    claimMaybeSingle,
    notificationClaimMaybeSingle,
    options,
    transactionRow,
  });

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
          update: vtuTransactionUpdate,
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
    rpc: createPendingTransactionRpcMock(options),
  } as unknown as SupabaseStub;
}
