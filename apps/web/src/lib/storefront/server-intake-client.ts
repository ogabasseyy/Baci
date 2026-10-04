import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Public product-request intake boundary. The submit RPC is service-role
// only so direct anon calls cannot bypass the intake route's proxy IP gate;
// this module is the single server-only path to it, limited to exactly
// submit_storefront_product_request. The client is never handed out —
// callers get only this narrow function. Provision a dedicated
// SUPABASE_STOREFRONT_INTAKE_KEY service-role JWT: the separate secret
// gives rotation independence and blast-radius accounting, but like every
// branded service client in this repo it inherently bypasses RLS — the
// narrow call graph (Zod route, IP gate, single RPC) is the control, not
// the key. The client fails closed without it and never falls back to
// the shared service key.

interface SubmitProductRequestRpc {
  rpc(
    name: 'submit_storefront_product_request',
    args: {
      p_query: string;
      p_contact: string;
      p_merchant_slug: string;
      p_request_id: string;
    }
  ): Promise<{ error: { code?: string; message?: string } | null }>;
}

export function submitStorefrontProductRequest(args: {
  p_query: string;
  p_contact: string;
  p_merchant_slug: string;
  p_request_id: string;
}): Promise<{ error: { code?: string; message?: string } | null }> {
  // The RPC postdates generated Database types; the cast is contained here
  // so no other module names an untyped privileged call.
  const client = createServiceClient(
    'storefront-public-intake'
  ) as unknown as SubmitProductRequestRpc;
  return client.rpc('submit_storefront_product_request', args);
}

export type { StorefrontPublicIntakeServiceClient } from '@/lib/supabase/service';
