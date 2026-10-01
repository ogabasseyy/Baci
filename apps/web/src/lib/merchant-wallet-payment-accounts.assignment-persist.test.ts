import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from './merchant-wallet-payment-accounts.test-support';
import { persistMerchantWalletAssignmentEvent } from './persist-merchant-wallet-assignment-event';

describe('merchant wallet payment-account provisioning — assignment persist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes persist RPC for a valid assignment event', async () => {
    const supabase = client([], {
      assignmentRequestRows: [{ id: 'r', merchant_id: 'm', status: 'pending' }],
    });
    const payload = {
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        account_number: '1234567890',
        account_name: 'A',
        currency: 'NGN',
        bank: { name: 'B' },
      },
    };
    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('match');
    expect(supabase.getRequestStatusFilters()).toEqual([
      ['pending', 'fulfilled'],
    ]);
  });

  it('ignores assignments when a direct source belongs to another flow', async () => {
    const supabase = client([], {
      assignmentRequestRows: [{ id: 'r', merchant_id: 'm', status: 'pending' }],
    });
    const payload = {
      data: {
        metadata: {
          source: 'other',
          request_id: 'wrong',
          merchant_id: 'wrong',
        },
        customer: {
          metadata: {
            source: 'merchant_wallet_funding',
            request_id: 'r',
            merchant_id: 'm',
          },
        },
        account_number: '1234567890',
        currency: 'NGN',
      },
    };

    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('ignored');
  });

  it('treats an exact fulfilled replay as success without rewriting the account', async () => {
    const supabase = client([], {
      assignmentRequestRows: [
        { id: 'r', merchant_id: 'm', status: 'fulfilled' },
      ],
      assignmentExisting: {
        account_number: '1234567890',
        account_name: 'A',
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
        account_name: 'A',
        currency: 'NGN',
      },
    };
    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('match');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('reviews a fulfilled replay when the existing account lookup fails', async () => {
    const supabase = client([], {
      assignmentRequestRows: [
        { id: 'r', merchant_id: 'm', status: 'fulfilled' },
      ],
      assignmentExistingError: new Error('account lookup failed'),
    });
    const payload = {
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        account_number: '1234567890',
        account_name: 'A',
        currency: 'NGN',
      },
    };

    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('review');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
