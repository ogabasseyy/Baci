import { createHmac } from 'node:crypto';

import { resolveMerchantWalletFundingRecoveryHmacSecret } from './provision-merchant-wallet-funding-recovery-hmac';

export function createMerchantWalletFundingRecoveryAttestation(input: {
  requestId: string;
  merchantId: string;
  accountNumber: string;
  accountName: string | null;
  bankName: string | null;
  currency: string;
  providerAccountId: string | null;
  providerCustomerCode: string | null;
  attestedAtIso: string;
}): string {
  const payload = [
    input.requestId,
    input.merchantId,
    input.accountNumber,
    input.accountName ?? '',
    input.bankName ?? '',
    input.currency,
    input.providerAccountId ?? '',
    input.providerCustomerCode ?? '',
    input.attestedAtIso,
  ].join('|');
  return createHmac('sha256', resolveMerchantWalletFundingRecoveryHmacSecret())
    .update(payload)
    .digest('hex');
}
