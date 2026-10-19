import {
  type CustomerSavingsEarningsRpcClient,
  fetchCustomerSavingsEarningsKobo,
} from '@baci/shared/lib';
import { supabase } from '@/lib/supabase';

export async function fetchWalletSavingsEarnings(merchantId: string) {
  const earningsClient =
    supabase as unknown as CustomerSavingsEarningsRpcClient;
  const creditedInterestKobo = await fetchCustomerSavingsEarningsKobo({
    client: earningsClient,
    merchantId,
  });

  return creditedInterestKobo === null
    ? { earnings_available: false, earnings_balance: null }
    : {
        earnings_available: true,
        earnings_balance: creditedInterestKobo / 100,
      };
}
