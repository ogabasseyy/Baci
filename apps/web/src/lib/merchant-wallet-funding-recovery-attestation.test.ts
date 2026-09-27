import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMerchantWalletFundingRecoveryAttestation } from './merchant-wallet-funding-recovery-attestation';

// Derived deterministically at runtime: stable across runs (no random test
// data) yet never a hardcoded secret literal.
const TEST_HMAC_SECRET = createHash('sha256')
  .update('merchant-wallet-funding-recovery-attestation-test')
  .digest('hex');

describe('createMerchantWalletFundingRecoveryAttestation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('HMACs the recovery payload with the configured funding-recovery secret', () => {
    vi.stubEnv(
      'MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET',
      TEST_HMAC_SECRET
    );
    const attestedAtIso = '2026-09-03T20:00:00.000Z';
    const attestation = createMerchantWalletFundingRecoveryAttestation({
      requestId: 'r1',
      merchantId: 'm1',
      accountNumber: '1234567890',
      accountName: 'Wallet',
      bankName: 'Wema',
      currency: 'NGN',
      providerAccountId: '9',
      providerCustomerCode: 'CUS_1',
      attestedAtIso,
    });

    expect(attestation).toBe(
      createHmac('sha256', TEST_HMAC_SECRET)
        .update(
          [
            'r1',
            'm1',
            '1234567890',
            'Wallet',
            'Wema',
            'NGN',
            '9',
            'CUS_1',
            attestedAtIso,
          ].join('|')
        )
        .digest('hex')
    );
  });

  it('fails closed when the funding-recovery secret is missing', () => {
    vi.stubEnv('MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET', '');
    expect(() =>
      createMerchantWalletFundingRecoveryAttestation({
        requestId: 'r1',
        merchantId: 'm1',
        accountNumber: '1234567890',
        accountName: null,
        bankName: null,
        currency: 'NGN',
        providerAccountId: null,
        providerCustomerCode: null,
        attestedAtIso: '2026-09-03T20:00:00.000Z',
      })
    ).toThrow(/MERCHANT_WALLET_FUNDING_RECOVERY_HMAC_SECRET/);
  });
});
