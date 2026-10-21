import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { getStorefrontIntakeToken } from './storefront-intake-token';

interface SubmitProductRequestRpc {
  rpc(
    name: 'submit_storefront_product_request',
    args: {
      p_query: string;
      p_contact: string;
      p_merchant_slug: string;
      p_request_id: string;
      p_caller_net_hash: string;
    }
  ): Promise<{ error: { code?: string; message?: string } | null }>;
}

export function submitStorefrontProductRequest(args: {
  p_query: string;
  p_contact: string;
  p_merchant_slug: string;
  p_request_id: string;
  p_caller_net_hash: string;
}): Promise<{ error: { code?: string; message?: string } | null }> {
  const token = getStorefrontIntakeToken();
  // Publishable gateway key plus a signed JWT for a NOINHERIT/NOBYPASSRLS
  // role granted this intake RPC with no direct request-table access.
  const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => token,
  }) as unknown as SubmitProductRequestRpc;
  return client.rpc('submit_storefront_product_request', args);
}
