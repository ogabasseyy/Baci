import { beforeEach, describe, expect, it, vi } from 'vitest';

const { customer, accounts } = vi.hoisted(() => ({
  customer: vi.fn(),
  accounts: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  createOrGetCustomer: customer,
  getDedicatedAccounts: accounts,
}));

vi.mock('./merchant-wallet-funding-recovery-attestation', () => ({
  createMerchantWalletFundingRecoveryAttestation: vi.fn(
    () => 'attestation-hex'
  ),
}));

import { createMerchantWalletFundingRecoveryAttestation } from './merchant-wallet-funding-recovery-attestation';
import {
  pickRecoverableFundingAccount,
  resumeMerchantWalletFundingRequest,
} from './resume-merchant-wallet-funding-request';

type ResumeClient = Parameters<typeof resumeMerchantWalletFundingRequest>[0] & {
  rpc: ReturnType<typeof vi.fn>;
};

function supabase(rpcData: unknown = null): ResumeClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: null }),
  } as unknown as ResumeClient;
}

function dva(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    assigned: true,
    currency: 'NGN',
    account_number: '1234567890',
    account_name: 'Wallet',
    bank: { name: 'Wema', id: 1, slug: 'wema-bank' },
    id: 9,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    customer: {
      id: 1,
      email: 'e@example.com',
      customer_code: 'CUS_1',
      first_name: null,
      last_name: null,
    },
    metadata: {
      source: 'merchant_wallet_funding',
      request_id: 'r1',
    },
    ...overrides,
  };
}

describe('pickRecoverableFundingAccount', () => {
  it('requires exactly one request-metadata-correlated active NGN account', () => {
    expect(
      pickRecoverableFundingAccount(
        [
          dva({
            account_number: '1111111111',
            metadata: {
              source: 'merchant_wallet_funding',
              request_id: 'other',
            },
          }),
          dva({ account_number: '1234567890' }),
        ],
        { id: 'r1', created_at: new Date().toISOString() }
      )?.account_number
    ).toBe('1234567890');
  });

  it('rejects a time-adjacent DVA that lacks funding-request metadata', () => {
    expect(
      pickRecoverableFundingAccount(
        [
          dva({
            created_at: new Date().toISOString(),
            metadata: null,
          }),
        ],
        {
          id: 'r1',
          created_at: new Date().toISOString(),
        }
      )
    ).toBeNull();
  });
});

describe('resumeMerchantWalletFundingRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customer.mockResolvedValue({
      success: true,
      data: { customer_code: 'CUS_1' },
    });
    accounts.mockResolvedValue({ success: true, data: [] });
  });

  it('completes a pending request via authenticated HMAC recovery when Paystack already assigned a correlated DVA', async () => {
    const createdAt = new Date().toISOString();
    accounts.mockResolvedValue({
      success: true,
      data: [dva({ created_at: createdAt })],
    });
    const client = supabase({ account_name: 'Wallet', bank_name: 'Wema' });

    await expect(
      resumeMerchantWalletFundingRequest(
        client,
        { id: 'm', email: 'e' },
        { id: 'r1', created_at: createdAt }
      )
    ).resolves.toMatchObject({
      status: 'active',
      account: { accountNumber: '1234567890', status: 'active' },
    });
    expect(createMerchantWalletFundingRecoveryAttestation).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'r1',
        merchantId: 'm',
        accountNumber: '1234567890',
        currency: 'NGN',
      })
    );
    expect(client.rpc).toHaveBeenCalledWith(
      'complete_merchant_wallet_funding_recovery',
      expect.objectContaining({
        p_request_id: 'r1',
        p_merchant_id: 'm',
        p_account_number: '1234567890',
        p_attestation: 'attestation-hex',
      })
    );
    expect(client.rpc).not.toHaveBeenCalledWith(
      'persist_merchant_wallet_payment_account',
      expect.anything()
    );
  });

  it('keeps the request pending when Paystack listing fails instead of expiring it', async () => {
    accounts.mockResolvedValue({
      success: false,
      error: 'timeout',
      code: 'NETWORK_ERROR',
    });
    const client = supabase();
    await expect(
      resumeMerchantWalletFundingRequest(
        client,
        { id: 'm', email: 'e' },
        {
          id: 'r1',
          created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        }
      )
    ).resolves.toEqual({
      status: 'pending',
      account: null,
      requestId: 'r1',
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('expires a stale pending request only after an authoritative empty listing', async () => {
    const client = supabase();
    await expect(
      resumeMerchantWalletFundingRequest(
        client,
        { id: 'm', email: 'e' },
        {
          id: 'r1',
          created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        }
      )
    ).rejects.toThrow('FUNDING_REQUEST_EXPIRED_RETRY');
    expect(client.rpc).toHaveBeenCalledWith(
      'fail_merchant_wallet_funding_request',
      { p_request_id: 'r1', p_merchant_id: 'm' }
    );
  });
});
