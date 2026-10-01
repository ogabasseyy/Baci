import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from './merchant-wallet-payment-accounts.test-support';
import { persistMerchantWalletAssignmentEvent } from './persist-merchant-wallet-assignment-event';

describe('merchant wallet payment-account provisioning — assignment replay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reviews a conflicting fulfilled replay without rewriting the account', async () => {
    const supabase = client([], {
      assignmentRequestRows: [
        { id: 'r', merchant_id: 'm', status: 'fulfilled' },
      ],
      assignmentExisting: {
        account_number: '1234567890',
        account_name: 'Original',
        bank_name: null,
        currency: 'NGN',
        provider_account_id: null,
        provider_customer_code: null,
      },
    });
    const payload = {
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        account_number: '1234567890',
        account_name: 'Changed',
        currency: 'NGN',
      },
    };
    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('review');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.getRequestStatusFilters()).toEqual([
      ['pending', 'fulfilled'],
    ]);
  });

  it.each([
    { assignmentRequestRows: [] },
    {
      assignmentRequestRows: [{ id: 'r', merchant_id: 'm', status: 'failed' }],
    },
  ])('reviews an inactive or unassigned funding request', async (options) => {
    const supabase = client([], options);
    const payload = {
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        account_number: '1234567890',
        currency: 'NGN',
      },
    };

    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('review');
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.getRequestStatusFilters()).toEqual([
      ['pending', 'fulfilled'],
    ]);
  });
});
