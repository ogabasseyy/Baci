import { beforeEach, describe, expect, it, vi } from 'vitest';

const { customer, dva } = vi.hoisted(() => ({
  customer: vi.fn(),
  dva: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  createOrGetCustomer: customer,
  createDedicatedAccount: dva,
  getDedicatedAccounts: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

import { requestMerchantWalletAccount } from './merchant-wallet-payment-accounts';
import { client } from './merchant-wallet-payment-accounts.test-support';

describe('merchant wallet payment-account provisioning — request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customer.mockResolvedValue({
      success: true,
      data: { customer_code: 'CUS' },
    });
    dva.mockResolvedValue({ success: true, data: { id: 'DVA' } });
  });

  it('reuses an existing active account without provider calls', async () => {
    const result = await requestMerchantWalletAccount(
      client([
        {
          account_name: 'A',
          account_number: '1234567890',
          bank_name: 'B',
          status: 'active',
        },
      ]),
      { id: 'm', email: 'e' }
    );
    expect(result.status).toBe('active');
    expect(customer).not.toHaveBeenCalled();
  });

  it('persists request before customer provisioning', async () => {
    const result = await requestMerchantWalletAccount(client(), {
      id: 'm',
      email: 'e',
    });
    expect(result.status).toBe('pending');
    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          request_id: 'req1',
          merchant_id: 'm',
          source: 'merchant_wallet_funding',
        }),
      })
    );
    expect(dva).toHaveBeenCalledWith(
      'CUS',
      expect.objectContaining({
        metadata: expect.objectContaining({
          request_id: 'req1',
          merchant_id: 'm',
          source: 'merchant_wallet_funding',
        }),
      })
    );
  });

  it('reuses a pending request after duplicate insert', async () => {
    const result = await requestMerchantWalletAccount(
      client([], { insertError: new Error('duplicate') }),
      { id: 'm', email: 'e' }
    );
    expect(result).toEqual({
      status: 'pending',
      account: null,
      requestId: 'pending',
    });
    expect(customer).toHaveBeenCalled();
  });

  it('fails safely when customer provisioning fails', async () => {
    customer.mockResolvedValue({ success: false });
    await expect(
      requestMerchantWalletAccount(client(), { id: 'm', email: 'e' })
    ).rejects.toThrow('Paystack customer provisioning failed');
  });

  it('marks the request failed when customer provisioning throws', async () => {
    customer.mockRejectedValue(new Error('provider timeout'));
    const supabase = client();
    await expect(
      requestMerchantWalletAccount(supabase, { id: 'm', email: 'e' })
    ).resolves.toEqual({
      status: 'pending',
      account: null,
      requestId: 'req1',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('requires review when the failure transition itself fails', async () => {
    customer.mockResolvedValue({ success: false });
    const supabase = client([], { rpcError: new Error('rpc down') });
    await expect(
      requestMerchantWalletAccount(supabase, { id: 'm', email: 'e' })
    ).rejects.toThrow('FUNDING_REQUEST_REVIEW_REQUIRED');
  });

  it('surfaces review when failed transition RPC fails', async () => {
    customer.mockResolvedValue({ success: false });
    await expect(
      requestMerchantWalletAccount(client([], { rpcError: new Error('rpc') }), {
        id: 'm',
        email: 'e',
      })
    ).rejects.toThrow('FUNDING_REQUEST_REVIEW_REQUIRED');
  });

  it('fails safely when DVA provisioning fails', async () => {
    dva.mockResolvedValue({ success: false });
    const supabase = client();
    await expect(
      requestMerchantWalletAccount(supabase, { id: 'm', email: 'e' })
    ).rejects.toThrow('Paystack DVA provisioning failed');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'fail_merchant_wallet_funding_request',
      { p_request_id: 'req1', p_merchant_id: 'm' }
    );
  });

  it('keeps the funding request pending after an ambiguous DVA transport failure', async () => {
    dva.mockResolvedValue({
      success: false,
      code: 'NETWORK_ERROR',
      error: 'socket hang up',
    });
    const supabase = client();
    await expect(
      requestMerchantWalletAccount(supabase, { id: 'm', email: 'e' })
    ).resolves.toEqual({
      status: 'pending',
      account: null,
      requestId: 'req1',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('marks the request failed when DVA provisioning throws', async () => {
    dva.mockRejectedValue(new Error('provider timeout'));
    const supabase = client();
    await expect(
      requestMerchantWalletAccount(supabase, { id: 'm', email: 'e' })
    ).resolves.toEqual({
      status: 'pending',
      account: null,
      requestId: 'req1',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('allows a later retry after a provider failure is transitioned to failed', async () => {
    customer.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({
      success: true,
      data: { customer_code: 'CUS2' },
    });
    const first = await expect(
      requestMerchantWalletAccount(client(), { id: 'm1', email: 'e' })
    ).rejects.toThrow('Paystack customer provisioning failed');
    expect(first).toBeDefined();
    const second = await requestMerchantWalletAccount(client(), {
      id: 'm1',
      email: 'e',
    });
    expect(second.status).toBe('pending');
    expect(dva).toHaveBeenCalledTimes(1);
  });
});
