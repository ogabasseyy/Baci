import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRootDomain } from '@/env';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { invalidateMerchantSlugRename } from '@/lib/invalidate-merchant-slug-rename';
import { RESERVED_PATHS } from '@/lib/validation';
import { merchantIdParamSchema } from '@/schemas/merchant-id-param';
import { renameSlugSchema } from '@/schemas/rename-slug';

/**
 * POST /api/merchant/rename-slug
 *
 * Changes a merchant's storefront URL (slug). The heavy lifting — validation,
 * authorization, the atomic slug + domain + alias update — lives in the
 * `rename_merchant_slug` Postgres RPC (the only path allowed past the slug
 * immutability trigger). This route authenticates, enforces CSRF, calls the RPC,
 * maps its errors to HTTP, and busts the affected caches.
 */

// Postgres RPC MESSAGE -> HTTP status.
const RPC_ERROR_STATUS: Record<string, number> = {
  invalid_slug: 400,
  reserved_slug: 400,
  no_current_slug: 400,
  slug_taken: 409,
  forbidden: 403,
  not_authenticated: 401,
};

// Postgres RPC MESSAGE -> friendly client message.
const RPC_ERROR_MESSAGE: Record<string, string> = {
  invalid_slug: 'Use only lowercase letters, numbers, and hyphens.',
  reserved_slug: 'That URL is reserved. Please choose another.',
  no_current_slug: 'This store does not have a URL to change yet.',
  slug_taken: 'That store URL is already taken.',
  forbidden: 'You do not have permission to change this store URL.',
  not_authenticated: 'Unauthorized',
};

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const parsed = renameSlugSchema
    .extend({ merchantId: merchantIdParamSchema })
    .safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: z.flattenError(parsed.error) },
      { status: 400 }
    );
  }

  const { merchantId, new_slug: requestedSlug } = parsed.data;
  const merchantContext = await getMerchantForApiRequest(
    auth.supabase,
    auth.user.id,
    { requestedMerchantId: merchantId }
  );
  if (!merchantContext || merchantContext.merchantId !== merchantId) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  // Mirror check_staff_permission (the DB helper rename_merchant_slug itself
  // calls) exactly for (resource='settings', action='edit'), so the route never
  // 403s a staff member the RPC would allow.
  const access = toUserAccess(merchantContext);
  const perms = access.permissions;
  const canRename =
    access.isOwner ||
    perms['*']?.['*'] === true ||
    perms['*']?.edit === true ||
    perms.settings?.['*'] === true ||
    perms.settings?.edit === true ||
    perms.settings?.all === true ||
    perms.full_access?.all === true;
  if (!canRename) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const newSlug = requestedSlug.toLowerCase();

  // Reject storefront route words (wallet, product, orders, ...) up-front with a
  // friendly message. These are valid slug SHAPES but the storefront layout /
  // merchant resolvers reject them (isValidMerchantIdentifier/RESERVED_PATHS), so
  // renaming to one would serve Store Not Found. The RPC's v_reserved is the
  // authoritative backstop; this keeps the two in sync via the shared JS set.
  if (RESERVED_PATHS.has(newSlug)) {
    return NextResponse.json(
      { error: RPC_ERROR_MESSAGE.reserved_slug, code: 'reserved_slug' },
      { status: 400 }
    );
  }

  // Capture the current slug BEFORE the rename so we can bust the by-slug lookup
  // cache for BOTH the old and the new slug afterwards (see below).
  const { data: currentMerchant } = await auth.supabase
    .from('merchants')
    .select('slug')
    .eq('id', access.merchantId)
    .maybeSingle();
  const previousSlug =
    typeof currentMerchant?.slug === 'string' ? currentMerchant.slug : null;

  const { data, error } = await auth.supabase.rpc('rename_merchant_slug', {
    p_merchant_id: access.merchantId,
    p_new_slug: newSlug,
  });

  if (error) {
    const key = (error.message ?? '').trim();
    const status = RPC_ERROR_STATUS[key] ?? 500;
    const message = RPC_ERROR_MESSAGE[key] ?? 'Failed to change store URL.';
    if (status === 500) {
      console.error('rename_merchant_slug failed:', error.message, error.code);
    }
    return NextResponse.json({ error: message, code: key }, { status });
  }

  // rename_merchant_slug returns { slug, retired_slug }. Prefer retired_slug — the
  // slug the RPC ACTUALLY retired under its row lock — over our pre-RPC read, which
  // can be stale if a concurrent rename of the same store interleaved (A->B then
  // A->C both read 'A', but the second call really retires 'B'). Falls back to the
  // pre-RPC read for a no-op or an unexpected shape.
  const renameResult =
    data && typeof data === 'object'
      ? (data as { slug?: unknown; retired_slug?: unknown })
      : null;
  const finalSlug =
    typeof renameResult?.slug === 'string' ? renameResult.slug : newSlug;
  const retiredSlug =
    typeof renameResult?.retired_slug === 'string'
      ? renameResult.retired_slug
      : previousSlug;
  const rootDomain = getRootDomain() || 'usebaci.com';

  invalidateMerchantSlugRename({
    merchantId: access.merchantId,
    finalSlug,
    retiredSlug,
  });

  return NextResponse.json({
    slug: finalSlug,
    url: `https://${finalSlug}.${rootDomain}`,
  });
}
