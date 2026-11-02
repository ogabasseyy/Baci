import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import {
  type WalletBackingState,
  walletBackingStateSchema,
} from '@/schemas/piggyvest/wallet-backing-state';

/**
 * 'unknown' means the state could not be read. Callers must treat it as "do
 * not proceed" (refuse, or answer 503); it never means legacy.
 */
export type CustomerBackingState = WalletBackingState | 'unknown';

const merchantIdSchema = z.uuid();

/**
 * Reads the signed-in customer's wallet backing state at one merchant.
 *
 * Pass the route's own request client (the normal server client carrying the
 * customer's session). The RPC resolves the customer from auth.uid(), so it
 * only ever reports the caller's own wallet. Any error, thrown failure or
 * unexpected reply is 'unknown'.
 */
export async function readCustomerBackingState(
  client: SupabaseClient,
  merchantId: string
): Promise<CustomerBackingState> {
  if (!merchantIdSchema.safeParse(merchantId).success) return 'unknown';
  try {
    const { data, error } = await client.rpc('get_my_wallet_backing_state', {
      p_merchant_id: merchantId,
    });
    if (error) return 'unknown';
    const parsed = walletBackingStateSchema.safeParse(data);
    return parsed.success ? parsed.data : 'unknown';
  } catch {
    return 'unknown';
  }
}
