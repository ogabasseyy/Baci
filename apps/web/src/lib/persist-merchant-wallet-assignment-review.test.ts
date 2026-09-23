import { describe, expect, it, vi } from 'vitest';
import { persistMerchantWalletAssignmentReview } from './persist-merchant-wallet-assignment-review';

describe('persistMerchantWalletAssignmentReview', () => {
  it('files a durable reconciliation review for assignment review outcomes', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await persistMerchantWalletAssignmentReview(supabase as never, {
      event: 'dedicatedaccount.assign.success',
      id: 'evt_1',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          merchant_id: '11111111-1111-4111-8111-111111111111',
          request_id: 'request-1',
        },
        dedicated_account: {
          account_number: '0123456789',
          currency: 'NGN',
          id: 'acct_1',
        },
      },
    });

    expect(supabase.from).toHaveBeenCalledWith('reconciliation_review');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'merchant_wallet_assignment_review',
        merchant_id: '11111111-1111-4111-8111-111111111111',
        paystack_ref: 'evt_1',
        metadata: expect.objectContaining({
          account_number: '0123456789',
          request_id: 'request-1',
        }),
      })
    );
  });

  it('bugfix: stores null merchant_id for malformed UUID values', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await persistMerchantWalletAssignmentReview(supabase as never, {
      event: 'dedicatedaccount.assign.success',
      id: 'evt_2',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          merchant_id: 'merchant-1',
          request_id: 'request-2',
        },
      },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant_id: null,
        metadata: expect.objectContaining({
          merchant_id_raw: 'merchant-1',
        }),
      })
    );
  });

  it('treats duplicate review inserts as idempotent success', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate' },
    });
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await expect(
      persistMerchantWalletAssignmentReview(supabase as never, {
        event: 'dedicatedaccount.assign.success',
        data: { metadata: { source: 'merchant_wallet_funding' } },
      })
    ).resolves.toBeUndefined();
  });
});
