import { productRequestSchema } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { submitStorefrontProductRequest } from '@/lib/storefront/server-intake-client';

// Public intake uses a restricted NOINHERIT/NOBYPASSRLS role with one RPC
// grant. The proxy adds the IP gate; the RPC enforces durable contact and
// merchant budgets. No session authority or service client is used.
export async function POST(request: NextRequest) {
  // Double-submit CSRF only when the request carries cookies: CSRF exploits
  // automatic cookie sending, so a cookie-less caller (the native app posts
  // no cookies and holds no session) has no ambient authority to abuse.
  // Browsers always attach cookies, so a cross-site page cannot deputize
  // them past this gate. (Mirrors the Bearer carve-out rationale in csrf.ts.)
  if (request.headers.get('cookie')) {
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
  const parsed = productRequestSchema.safeParse(input);
  if (!parsed.success)
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  let result: Awaited<ReturnType<typeof submitStorefrontProductRequest>>;
  try {
    result = await submitStorefrontProductRequest({
      p_query: parsed.data.query,
      p_contact: parsed.data.contact,
      p_merchant_slug: parsed.data.merchantSlug,
      p_request_id: parsed.data.requestId,
    });
  } catch {
    // Fail closed (e.g. narrow intake key unprovisioned): never serve
    // intake on a degraded credential path, and leak nothing about why.
    return Response.json({ error: 'Intake unavailable' }, { status: 503 });
  }
  const { error } = result;
  if (!error) return Response.json({ ok: true });
  // Map on SQLSTATE only: message substrings would mis-route if RPC text
  // ever changes. Codes are pinned by the intake migrations (54000
  // budget, 23505 id conflict, P0001 store unavailable, 22023
  // validation) and covered by the route tests.
  const info = error as { code?: string };
  if (info.code === '54000') {
    // Merchant-scoped spike signal for budget-abuse alerting. The contact
    // stays out of logs; per-contact rotation is visible only as volume.
    logger.warn({
      message: 'Product request intake rate limited',
      merchantSlug: parsed.data.merchantSlug,
    });
    return Response.json({ error: 'Request limit reached' }, { status: 429 });
  }
  if (info.code === 'P0001')
    return Response.json({ error: 'Store unavailable' }, { status: 404 });
  if (info.code === '23505')
    return Response.json({ error: 'Request conflict' }, { status: 409 });
  if (info.code === '22023')
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  logger.warn({
    message: 'Product request intake failed',
    errorCode: info.code,
  });
  return Response.json(
    { error: 'Couldn’t send your request' },
    { status: 500 }
  );
}
