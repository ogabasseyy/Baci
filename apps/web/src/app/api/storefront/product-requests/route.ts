import { productRequestSchema } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { hashIntakeCallerNet } from '@/lib/storefront/hash-intake-caller-net';
import { submitStorefrontProductRequest } from '@/lib/storefront/server-intake-client';

// Public intake threat model. This route exercises no session authority: it
// forwards Zod-validated input to the restricted storefront_intake RPC, so
// there is no login, cookie, or device signal to bind abuse budgets to —
// the network origin is the only server-verifiable caller signal. The
// durable budget is keyed on the TRUSTED identifier (see
// getTrustedClientIdentifier), never the lenient proxy one: header values
// a caller can mint per request would mint a fresh DB bucket per request
// too, leaving the durable layer with no binding power at all. Behind
// Cloudflare the helper prefers CF-Connecting-IP verified against
// Cloudflare egress ranges, so shoppers sharing an egress IP don't pool
// one durable bucket (without that, every Vercel header names the egress).
// Deliberately rejected controls, with bypass reasons:
// - Host binding (Host merchant must equal body slug): an attacker POSTs
//   directly to the victim host with the victim slug and passes; a native
//   fallback path would exempt the attacker too. Theater either way.
// - Signed storefront context tokens: the issuance endpoint would itself
//   be public and unauthenticated, so the attacker mints victim-scoped
//   tokens at will; a token only proves "called issuance first". Binding
//   issuance to the CSRF cookie fails the same way (double-submit pairs
//   are self-mintable by fetching any page). Meaningful only under a
//   scarce issuance signal, which is the actual control, not the token.
// - Cookie-split sub-budgets ("verified web" vs anon): same self-mintable
//   issuance flaw; bypassed by the exact target while throttling honest
//   native users. Previously shipped and reverted for this reason.
// - CAPTCHA / proof-of-work: the only options that bound DISTRIBUTED
//   abuse without accounts, but CAPTCHA needs a vendor, UX, and native
//   SDK work, while enforced PoW breaks currently shipped native clients
//   (any version-gated grace lets the attacker claim the old version).
//   Both need owner sign-off; they are not unilateral per-request fixes.
// What IS enforced, in binding order: the proxy's per-IP sliding window
// (10/hour across all merchants, lenient signal) binds first while Redis
// is healthy; the RPC's durable per-(merchant, network-origin) fixed
// window (10/hour, trusted signal) backstops it across Redis outages and
// per-instance memory fallbacks, when one IP could otherwise spend the
// whole merchant budget; the merchant (50/hour) and contact (3/hour)
// budgets bound total harm. On Vercel the lenient and trusted signals
// agree (same edge-verified IP), so both layers measure the same caller;
// anywhere the edge guarantee is absent the durable key collapses into
// the shared 'unknown' bucket (fail-closed) instead of rotating.
// Budgets fail closed (503/429, never silent allow). Residual: callers
// with many real network origins can still pool the merchant budget
// (inbox volume plus legit-shopper 429s) — this needs the owner-gated
// scarce signal above, not another header or cookie check.
export async function POST(request: NextRequest) {
  // Double-submit CSRF only when the request carries cookies: this route
  // exercises no session or ambient authority (it only forwards Zod-validated
  // input to the restricted storefront_intake RPC), so a cookie-less caller
  // gains nothing past this gate. Cookie presence only decides whether a
  // double-submit token can exist to check; it is not a browser guarantee.
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
      // Trusted network signal (never the lenient proxy one), HMAC-hashed
      // with the dedicated intake-net key so raw IPs never reach the
      // database. The RPC enforces the durable per-(merchant, origin)
      // budget on this value.
      p_caller_net_hash: hashIntakeCallerNet(
        getTrustedClientIdentifier(request)
      ),
    });
  } catch {
    // Fail closed (e.g. narrow intake key unprovisioned): never serve
    // intake on a degraded credential path, and leak nothing about why.
    // The client gets a neutral 503; the server log records the outage
    // without credential detail so a provisioning failure is visible.
    logger.warn({ message: 'Product request intake unavailable' });
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
