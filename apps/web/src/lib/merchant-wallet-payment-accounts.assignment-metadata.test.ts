import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from './merchant-wallet-payment-accounts.test-support';
import { persistMerchantWalletAssignmentEvent } from './persist-merchant-wallet-assignment-event';

describe('merchant wallet payment-account provisioning — assignment metadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    {},
    { data: {} },
  ])('ignores assignment metadata without an explicit source', async (payload) => {
    expect(
      (await persistMerchantWalletAssignmentEvent(client(), payload)).kind
    ).toBe('ignored');
  });

  it('ignores assignment metadata from another source', async () => {
    const payload = { data: { metadata: { source: 'other' } } };
    expect(
      (await persistMerchantWalletAssignmentEvent(client(), payload)).kind
    ).toBe('ignored');
  });

  it('reviews wallet assignment metadata missing merchant correlation', async () => {
    const payload = {
      data: {
        metadata: { source: 'merchant_wallet_funding', request_id: 'r' },
      },
    };
    expect(
      (await persistMerchantWalletAssignmentEvent(client(), payload)).kind
    ).toBe('review');
  });

  it('reviews malformed account number and wrong currency', async () => {
    const base = {
      source: 'merchant_wallet_funding',
      request_id: 'r',
      merchant_id: 'm',
    };
    expect(
      (
        await persistMerchantWalletAssignmentEvent(client(), {
          data: { metadata: base, account_number: '12', currency: 'NGN' },
        })
      ).kind
    ).toBe('review');
    expect(
      (
        await persistMerchantWalletAssignmentEvent(client(), {
          data: {
            metadata: base,
            account_number: '1234567890',
            currency: 'USD',
          },
        })
      ).kind
    ).toBe('review');
  });

  it.each([
    { active: false },
    { assigned: false },
  ])('reviews provider assignments with flags %j', async (flags) => {
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
        currency: 'NGN',
        ...flags,
      },
    };

    expect(
      (await persistMerchantWalletAssignmentEvent(supabase, payload)).kind
    ).toBe('review');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
