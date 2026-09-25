import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const JUMIA_CREDENTIAL_LOADER_TTL_SECONDS = 60;

/**
 * Builds the server-only client for the Jumia credential grant RPC.
 *
 * The minted JWT binds the authorized user, merchant, and a fixed server
 * context to the narrow `jumia_credential_loader` role (60s TTL), which can
 * execute nothing but the grant RPC. Callers must complete the owner/manage
 * check first; the RPC re-verifies the claims and the permission rule in
 * the database, so no service-role elevation enters user-facing graphs.
 */
export function createJumiaCredentialLoaderClient(
  userId: string,
  merchantId: string,
  now = new Date()
): SupabaseClient {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const token = signScopedSupabaseJwt({
    aud: 'authenticated',
    exp: issuedAt + JUMIA_CREDENTIAL_LOADER_TTL_SECONDS,
    iat: issuedAt,
    jti: crypto.randomUUID(),
    jumia_credential_context: 'server-grant-load',
    jumia_credential_merchant_id: merchantId,
    jumia_credential_user_id: userId,
    role: 'jumia_credential_loader',
  });

  return createScopedClient(token);
}
