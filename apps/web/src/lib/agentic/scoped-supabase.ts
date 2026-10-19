import { createClient } from '@supabase/supabase-js';
import 'server-only';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const TOKEN_TTL_SECONDS = 5 * 60;

export function createAgenticScopedSupabaseClient({
  merchantId,
  merchantSlug,
  sessionId,
  now = new Date(),
}: {
  merchantId: string;
  merchantSlug: string;
  sessionId?: string;
  now?: Date;
}) {
  if (!merchantId?.trim() || !merchantSlug?.trim()) {
    throw new Error('Agentic merchant context is required');
  }

  const normalizedMerchantId = merchantId.trim();
  const normalizedMerchantSlug = merchantSlug.trim();
  const normalizedSessionId = sessionId?.trim();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: Record<string, unknown> = {
    agentic_context: 'checkout',
    agentic_merchant_id: normalizedMerchantId,
    agentic_merchant_slug: normalizedMerchantSlug,
    aud: 'authenticated',
    exp: issuedAt + TOKEN_TTL_SECONDS,
    iat: issuedAt,
    role: 'authenticated',
    sub: normalizedMerchantId,
  };

  if (normalizedSessionId) {
    payload.agentic_session_id = normalizedSessionId;
  }

  const token = signScopedSupabaseJwt(payload);

  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

/** Server-only authority to resolve one configured merchant's private controls. */
export function createAgenticMerchantContextClient(
  slug: string,
  now = new Date()
) {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug || Buffer.byteLength(normalizedSlug, 'utf8') > 254) {
    throw new Error('Agentic merchant slug is required');
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const token = signScopedSupabaseJwt({
    aud: 'authenticated',
    role: 'agentic_merchant_context',
    agentic_merchant_slug: normalizedSlug,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  });
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
