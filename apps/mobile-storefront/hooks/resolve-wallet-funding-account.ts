import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { projectWalletFundingAccount } from './project-wallet-funding-account';

export async function resolveWalletFundingAccount(
  data: unknown,
  merchantId: string
) {
  if (!isPiggyvestPrimaryMerchant(merchantId))
    return projectWalletFundingAccount(data, merchantId);
  try {
    const { account } = await piggyvestPrimaryWalletApi.read(merchantId);
    if (!account) return null;
    return {
      account_name: account.accountName,
      account_number: account.accountNumber,
      bank_name: account.bankName,
      provider: account.provider,
    };
  } catch {
    return null;
  }
}
