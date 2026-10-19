import type { SupabaseClient } from '@supabase/supabase-js';
import { loadUcpCartSession } from './ucp-cart-session-read';
import {
  mapUcpCartWriteError,
  UcpCartMigratedError,
  ucpCartCallerMismatch,
} from './ucp-cart-storage';

/** Reload only after the database confirms that migration fenced this write. */
export async function ucpCartMigrationRaceOutcome({
  error,
  cartId,
  merchantId,
  agentId,
  supabase,
}: {
  error: unknown;
  cartId: string;
  merchantId: string;
  agentId?: string | null;
  supabase: SupabaseClient;
}) {
  const mapped = mapUcpCartWriteError(error);
  if (!(mapped instanceof UcpCartMigratedError)) return null;
  const latest = await loadUcpCartSession({
    cartId,
    merchantId,
    supabase,
  }).catch(() => ({ cart: null, error: true }));
  // A refresh can still be requested if the reload fails; never expose a
  // successor belonging to a different recorded caller.
  const canonicalId =
    !latest.error &&
    latest.cart &&
    !ucpCartCallerMismatch(latest.cart, agentId, { mutation: true })
      ? latest.cart.migratedToCartId
      : null;
  const migrated = new UcpCartMigratedError(canonicalId);
  return {
    body: {
      cart_id: migrated.cartId,
      code: migrated.code,
      error: migrated.message,
    },
    status: 409 as const,
  };
}
