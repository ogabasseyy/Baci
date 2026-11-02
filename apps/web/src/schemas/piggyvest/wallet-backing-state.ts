import z from 'zod';

/**
 * Reply of public.get_my_wallet_backing_state
 * (supabase/migrations/20261102033304_piggyvest_primary_wallet_backing.sql):
 * 'none' when the caller has no customer record at the merchant, otherwise
 * the wallet's state. The database is the authority; anything else is refused.
 */
export const walletBackingStateSchema = z.enum([
  'none',
  'legacy',
  'migrating',
  'backed',
]);

export type WalletBackingState = z.infer<typeof walletBackingStateSchema>;
