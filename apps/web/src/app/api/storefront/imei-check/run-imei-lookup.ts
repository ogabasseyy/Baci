import 'server-only';
import type { User } from '@supabase/supabase-js';
import { executeImeiLookup } from './execute-imei-lookup';
import { startImeiWalletPayment } from './wallet-pay/start-imei-wallet-payment';

/**
 * Picks how an IMEI check is paid. 'store_credit' is the existing flow,
 * unchanged; 'piggyvest_wallet' only creates the lookup and asks for a
 * PIN-confirmed PiggyVest payment (see wallet-pay/).
 */
export async function runImeiLookup(
  paymentMethod: 'store_credit' | 'piggyvest_wallet',
  input: Parameters<typeof executeImeiLookup>[0] & { user: User }
) {
  if (paymentMethod === 'piggyvest_wallet')
    return await startImeiWalletPayment(input);
  const { user: _user, ...storeCredit } = input;
  return await executeImeiLookup(storeCredit);
}
