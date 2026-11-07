import { createClient } from '@supabase/supabase-js';
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import type { SharedCartBindingRef } from '@/lib/agentic/checkout-order-binding';
import type { AgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const TOKEN_TTL_SECONDS = 60;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DvaPostLogoutFinalizerScope = {
  accountNumber: string;
  binding: SharedCartBindingRef;
  finalizationClaim: string;
  merchantId: string;
};

/** The read-only probe only selects the finalizer after exact evidence exists
 * and the original grant is no longer live. The binder repeats every check
 * under its transaction locks before creating the order. */
export async function hasDvaPostLogoutFinalizationEvidence(input: {
  accountNumber: string;
  binding: SharedCartBindingRef;
  finalizationClaim: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  if (typeof input.supabase.rpc !== 'function') return false;
  try {
    const { data, error } = await input.supabase.rpc(
      'commerce_cart_agentic_dva_recovery_available',
      {
        p_account_number: input.accountNumber,
        p_cart_id: input.binding.cart_id,
        p_cart_version: input.binding.cart_version,
        p_finalization_claim: input.finalizationClaim,
        p_generation: input.binding.checkout_generation,
        p_merchant_id: input.merchantId,
        p_session_id: input.binding.checkout_session_id,
      }
    );
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Creates a one-minute, server-only capability used only after the ordinary
 * shared-cart binder rejects a retired principal. The SQL binder independently
 * matches this scope to locked session state and immutable provider evidence.
 * The dedicated database role intentionally has no authenticator membership;
 * this client is dormant until gateway role switching is separately proven.
 */
export function createDvaPostLogoutFinalizerClient(
  scope: DvaPostLogoutFinalizerScope,
  options: {
    now?: Date;
    signer?: AgenticJwtSigningMaterial;
  } = {}
) {
  validateScope(scope);
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const token = signScopedSupabaseJwt(
    {
      aud: 'authenticated',
      role: 'agentic_dva_finalizer',
      agentic_context: 'checkout',
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_SECONDS,
      agentic_dva_post_logout: {
        version: '1',
        merchant_id: scope.merchantId,
        checkout_session_id: scope.binding.checkout_session_id,
        cart_id: scope.binding.cart_id,
        cart_version: scope.binding.cart_version,
        checkout_generation: scope.binding.checkout_generation,
        account_number: scope.accountNumber,
        finalization_claim: scope.finalizationClaim,
      },
    },
    options.signer
  );

  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function validateScope(scope: DvaPostLogoutFinalizerScope) {
  if (!UUID_RE.test(scope.merchantId) || !UUID_RE.test(scope.binding.cart_id)) {
    throw new Error('DVA finalizer scope identifiers are invalid');
  }
  if (!UUID_RE.test(scope.binding.checkout_session_id)) {
    throw new Error('DVA finalizer session identifier is invalid');
  }
  if (
    !Number.isSafeInteger(scope.binding.cart_version) ||
    scope.binding.cart_version < 1 ||
    !Number.isSafeInteger(scope.binding.checkout_generation) ||
    scope.binding.checkout_generation < 1
  ) {
    throw new Error('DVA finalizer binding version is invalid');
  }
  if (!/^\d{10}$/.test(scope.accountNumber)) {
    throw new Error('DVA finalizer account number is invalid');
  }
  if (
    typeof scope.finalizationClaim !== 'string' ||
    scope.finalizationClaim.length < 1 ||
    scope.finalizationClaim.length > 256
  ) {
    throw new Error('DVA finalizer claim is invalid');
  }
}
