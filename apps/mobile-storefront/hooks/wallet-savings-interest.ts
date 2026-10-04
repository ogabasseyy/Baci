import { supabase } from '@/lib/supabase';
import {
  WalletSavingsInterestRequestSchema,
  type WalletSavingsInterestResponse,
  WalletSavingsInterestResponseSchema,
} from '@/schemas/wallet-savings-interest';
import { fetchWalletSavingsEarnings } from './wallet-savings-earnings';

type InterestRpcClient = {
  rpc: (
    functionName: 'get_customer_savings_earnings',
    args: { p_merchant_id: string; p_include_goals: true }
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
};

type WalletSavingsInterest = {
  status: 'available' | 'unavailable';
  creditedInterestKobo: number | null;
  goalInterestKobo: WalletSavingsInterestResponse['goal_interest_kobo'];
};

const missingFunctionCodes = new Set(['PGRST202', '42883']);

function unavailable(): WalletSavingsInterest {
  return {
    status: 'unavailable',
    creditedInterestKobo: null,
    goalInterestKobo: [],
  };
}

export async function fetchWalletSavingsInterest(
  merchantId: string
): Promise<WalletSavingsInterest> {
  const request = WalletSavingsInterestRequestSchema.safeParse({
    p_merchant_id: merchantId,
    p_include_goals: true,
  });
  if (!request.success) return unavailable();

  const client = supabase as unknown as InterestRpcClient;
  try {
    const { data, error } = await client.rpc(
      'get_customer_savings_earnings',
      request.data
    );
    if (error) {
      if (!missingFunctionCodes.has(error.code ?? '')) return unavailable();
      const legacyEarnings = await fetchWalletSavingsEarnings(merchantId);
      const creditedInterestKobo =
        legacyEarnings.earnings_balance === null
          ? null
          : Math.round(legacyEarnings.earnings_balance * 100);
      return !legacyEarnings.earnings_available ||
        creditedInterestKobo === null ||
        !Number.isSafeInteger(creditedInterestKobo)
        ? unavailable()
        : {
            status: 'available',
            creditedInterestKobo,
            goalInterestKobo: [],
          };
    }

    const parsed = WalletSavingsInterestResponseSchema.safeParse(data);
    if (!parsed.success) return unavailable();
    return {
      status: 'available',
      creditedInterestKobo: parsed.data.credited_interest_kobo,
      goalInterestKobo: parsed.data.goal_interest_kobo,
    };
  } catch {
    return unavailable();
  }
}

export function toWalletSavingsInterestEarnings(
  interest: WalletSavingsInterest
) {
  return {
    earnings_available: interest.status === 'available',
    earnings_balance:
      interest.creditedInterestKobo === null
        ? null
        : interest.creditedInterestKobo / 100,
  };
}
