import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

interface AdminGiglQuotePersistenceInput {
  attestation: Record<string, unknown>;
  quote: Record<string, unknown>;
  /** Caller-bound client; never constructs a service-role client. */
  supabase: SupabaseClient;
}

/**
 * Persists an Admin GIGL quote through the authenticated order-scoped RPC.
 * The server HMAC binds the complete provider response before the SECURITY
 * DEFINER writer accepts it; ownership / orders:fulfill remains DB-enforced.
 */
export function persistAdminGiglQuote({
  attestation,
  quote,
  supabase,
}: AdminGiglQuotePersistenceInput) {
  const orderId = String(attestation.order_id ?? '');
  const merchantId = String(attestation.merchant_id ?? '');
  const routeProof = createShippingQuoteRouteProof({
    action: 'persist_authenticated_admin_gigl_quote',
    merchantId,
    subjectId: orderId,
    payload: { quote, attestation },
  });
  return supabase.rpc(
    'persist_authenticated_admin_gigl_quote' as never,
    {
      p_quote: quote,
      p_attestation: attestation,
      p_route_proof: routeProof,
    } as never
  ) as unknown as Promise<{
    data: string | null;
    error: { message?: string } | null;
  }>;
}
