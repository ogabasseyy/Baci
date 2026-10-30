import { describe, expect, it, vi } from 'vitest';
import {
  redeemImeiWalletAndBeginProviderSubmission,
  redeemImeiWalletPayment,
  refundImeiWalletPayment,
} from './imei-wallet-payments';

const identity = {
  amount: 500,
  customerId: 'customer',
  lookupId: 'lookup',
  merchantId: 'merchant',
};

describe('IMEI wallet capability operations', () => {
  it.each([
    redeemImeiWalletPayment,
    refundImeiWalletPayment,
  ])('propagates denied wallet operations without retrying or changing identity', async (operation) => {
    const denied = { code: '42501', message: 'scope denied' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: denied });
    await expect(
      operation({ ...identity, supabaseAdmin: { rpc } })
    ).rejects.toBe(denied);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_amount: 500,
      p_customer_id: 'customer',
      p_lookup_id: 'lookup',
      p_merchant_id: 'merchant',
    });
  });

  it('uses one atomic debit and write-ahead operation before a Petrock submission', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await redeemImeiWalletAndBeginProviderSubmission({
      ...identity,
      costUsd: 0.06,
      feedbackTokenHash: 'token-hash',
      identifierCiphertext: 'ciphertext',
      providerAttemptStartedAt: '2026-10-30T00:00:00Z',
      referenceId: 'reference',
      supabaseAdmin: { rpc },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'redeem_imei_wallet_and_begin_provider_submission',
      expect.objectContaining({
        p_provider: 'petrock',
        p_feedback_token_hash: 'token-hash',
        p_identifier_ciphertext: 'ciphertext',
        p_reference_id: 'reference',
        p_device_category: null,
        p_amount: 500,
      })
    );
  });

  it('surfaces ambiguous atomic transport failures without issuing a second debit', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('transport disconnected'));
    await expect(
      redeemImeiWalletAndBeginProviderSubmission({
        ...identity,
        costUsd: 0.06,
        feedbackTokenHash: 'hash',
        identifierCiphertext: 'cipher',
        providerAttemptStartedAt: '2026-10-30T00:00:00Z',
        referenceId: 'reference',
        supabaseAdmin: { rpc },
      })
    ).rejects.toThrow('transport disconnected');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
