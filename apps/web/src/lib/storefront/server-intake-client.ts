import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';

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

/** Reject privileged/misconfigured credentials before constructing a client.
 * Supabase verifies the JWT signature; this local check constrains configuration.
 */
function intakeToken(): string {
  const token = process.env.SUPABASE_STOREFRONT_INTAKE_KEY;
  try {
    if (token?.split('.').length !== 3) throw new Error();
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    if (
      !claims ||
      typeof claims !== 'object' ||
      !('role' in claims) ||
      claims.role !== 'storefront_intake'
    )
      throw new Error();
  } catch {
    throw new Error('Restricted storefront intake credential is unavailable');
  }
  return token;
}

export function submitStorefrontProductRequest(args: {
  p_query: string;
  p_contact: string;
  p_merchant_slug: string;
  p_request_id: string;
}): Promise<{ error: { code?: string; message?: string } | null }> {
  const token = intakeToken();
  // Publishable gateway key plus a signed JWT for a NOINHERIT/NOBYPASSRLS
  // role granted this intake RPC with no direct request-table access.
  const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => token,
  }) as unknown as SubmitProductRequestRpc;
  return client.rpc('submit_storefront_product_request', args);
}
