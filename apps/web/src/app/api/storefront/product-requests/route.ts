import { productRequestSchema } from '@baci/shared/lib';
import { logger } from '@/lib/logger';
import { submitStorefrontProductRequest } from '@/lib/storefront/server-intake-client';

// Public intake for storefront product requests. The submit RPC is
// service-role only, so all callers come through here: the proxy adds a
// trusted per-IP network gate (rate-limit-routes) in front of the DB's
// per-contact and per-merchant budgets. The route never constructs a
// service client itself; the server-only intake helper owns the single
// branded RPC call. No session is involved, so there is no ambient
// authority for CSRF to abuse.
export async function POST(request: Request) {
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
  const info = error as { code?: string; message?: string };
  if (info.code === '54000' || info.message?.includes('Request limit reached'))
    return Response.json({ error: 'Request limit reached' }, { status: 429 });
  if (info.message?.includes('Store unavailable'))
    return Response.json({ error: 'Store unavailable' }, { status: 404 });
  if (info.message?.includes('Request conflict'))
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
