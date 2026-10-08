import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { walletFundingAccountDatabaseSchema } from '@/schemas/wallet-funding-account-database';

export function projectWalletFundingAccount(data: unknown, merchantId: string) {
  if (isPiggyvestPrimaryMerchant(merchantId)) return null;
  const parsed = walletFundingAccountDatabaseSchema.nullable().safeParse(data);
  return parsed.success ? parsed.data : null;
}
