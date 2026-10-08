import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { isPrimaryWalletNotReady } from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import {
  parseProjectWalletFundingAccount,
  projectWalletFundingAccount,
} from './project-wallet-funding-account';

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
  } catch (error) {
    // The server positively reports primary as unconfigured (e.g. mobile
    // released ahead of the server capability): keep the working legacy
    // funding account instead of stranding the customer with none.
    if (isPrimaryWalletNotReady(error))
      return parseProjectWalletFundingAccount(data);
    return null;
  }
}
