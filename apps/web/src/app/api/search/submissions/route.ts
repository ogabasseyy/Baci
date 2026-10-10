import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import type { CachedMerchant } from '@/lib/cached-data';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { logger } from '@/lib/logger';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  isLocalhost,
  isPlatformHost,
  normalizeHostname,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { recordSearchSubmission } from '@/lib/search/server-analytics-client';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import { createClient } from '@/lib/supabase/server';
import { searchSubmissionSchema } from '@/schemas/search-submission';

function unavailable() {
  return NextResponse.json(
    { error: 'Search tracking unavailable' },
    { status: 503 }
  );
}

// Same crawler tokens as the shared proxy regex, but token-boundaried: the
// shared bare-substring match would shed real shoppers whose device model
// merely contains "bot" (e.g. CUBOT Android phones). Kept local so proxy
// routing semantics stay untouched.
const SUBMISSION_BOT_USER_AGENT_REGEX =
  /\b(?:bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkshare|w3c_validator)\b/i;

/**
 * Public, best-effort telemetry. The proxy applies the dedicated per-IP budget.
 *
 * No double-submit CSRF token by design: this endpoint never calls
 * checkCsrfProtection (whose exemption list covers only /api/platform/events)
 * and the proxy enforces a hostname allowlist, not tokens — and storefront
 * pages do not mint CSRF cookies (CsrfInitializer mounts only in
 * admin/dashboard/builder), so token enforcement would reject every
 * legitimate submission. Cross-site forgery is instead blocked by the strict
 * same-Origin check below — browsers always send Origin on fetch/form POSTs,
 * and a missing or mismatched Origin is a 403 — plus bot/UA filtering, a
 * bounded body, Zod validation, and the per-IP budget. The worst case for a
 * forged same-shape request is a polluted analytics count; no privileged
 * state is reachable here.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const requestHost = request.headers.get('host') || request.nextUrl.host;
  // Shed known automation before the Origin gate so bots stay silent:
  // they would otherwise each mint a 403 warn log without ever recording.
  // An empty UA is not itself proof of automation, so it proceeds to the
  // Origin gate and can still record when same-origin.
  const userAgent = request.headers.get('user-agent') || '';
  if (
    userAgent &&
    (SUBMISSION_BOT_USER_AGENT_REGEX.test(userAgent) ||
      /curl|wget|python-requests|headlesschrome/i.test(userAgent))
  ) {
    return new NextResponse(null, { status: 204 });
  }
  try {
    const originUrl = new URL(origin || '');
    if (
      originUrl.host !== requestHost ||
      originUrl.protocol !== request.nextUrl.protocol
    ) {
      // Origin rejections shed telemetry silently for shoppers, so log them
      // for operators: a proxy or preview setup rewriting host/protocol
      // shows up here instead of as mysteriously flat submission counts.
      logger.warn({
        message: 'Search submission blocked: origin mismatch',
        originHost: originUrl.host,
        requestHost,
      });
      return NextResponse.json(
        { error: 'Cross-origin request blocked' },
        { status: 403 }
      );
    }
  } catch {
    logger.warn({
      message: 'Search submission blocked: invalid origin',
      origin: origin ?? null,
      requestHost,
    });
    return NextResponse.json(
      { error: 'Invalid Origin header' },
      { status: 403 }
    );
  }

  // Compare only the media type, case-insensitively: parameters (e.g.
  // charset) must not affect the gate, and lookalikes such as
  // application/json-malicious must not pass it.
  const mediaType = request.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    return NextResponse.json({ error: 'Expected JSON' }, { status: 415 });
  }
  const bodyResult = await readBoundedJsonBody(request, 2048);
  if (!bodyResult.ok) {
    return bodyResult.reason === 'too_large'
      ? NextResponse.json({ error: 'Payload too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = searchSubmissionSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid search submission' },
      { status: 400 }
    );
  }

  try {
    const host = normalizeHostname(requestHost);
    const subdomain = isLocalhost(host)
      ? extractLocalhostSubdomain(host)
      : extractSubdomain(host, ROOT_DOMAIN);
    // Platform-host tenant attribution is best-effort by necessity: the
    // request URL carries no merchant identity, and every caller-controlled
    // signal (body, Referer — settable same-origin via RequestInit.referrer —
    // even Host for direct HTTP clients) is forgeable. No header check can
    // prove which public page issued an anonymous same-origin request, so
    // none is attempted: the enforced controls are the revoked direct
    // writes, the server-derived query/count, and the per-IP proxy budget,
    // which bound the residual cross-slug pollution to noisy analytics.
    const identifier = isPlatformHost(host)
      ? parsed.data.pathPrefix.slice(1)
      : subdomain
        ? RESERVED_SUBDOMAINS.has(subdomain)
          ? ''
          : subdomain
        : host.replace(/^www\./, '');
    // Mirror proxy apex-then-exact resolution (getSlugForOriginCustomDomain):
    // a merchant registered only under the full www hostname must still
    // resolve when the apex lookup misses.
    const identifiers =
      !isPlatformHost(host) && !subdomain && identifier !== host
        ? [identifier, host]
        : [identifier];
    let merchant: CachedMerchant | null = null;
    for (const candidate of identifiers) {
      if (!candidate) continue;
      merchant = await getRequestScopedMerchant(candidate);
      if (merchant) break;
    }
    if (!merchant) {
      return NextResponse.json(
        { error: 'Unknown storefront' },
        { status: 404 }
      );
    }
    const supabase = createClient(await cookies());
    const result = await searchStorefrontProducts({
      supabase,
      merchantId: merchant.id,
      query: parsed.data.query,
      limit: 1,
      includeDidYouMean: false,
    });
    // Narrow ingestion edge: every value is server-derived (merchant from
    // the snapshot lookup, query/count from the bounded search RPC), and
    // anon / authenticated table writes are revoked (#3581) so the endpoint
    // gates cannot be bypassed with a direct table write. The wrapper
    // throws only on a programming error (its asserts accept every value
    // built here), so log it distinctly from DB downtime.
    try {
      const { error } = await recordSearchSubmission({
        merchant_id: merchant.id,
        search_query: result.query,
        results_count: result.count,
        search_method: 'client',
      });
      if (error) return unavailable();
    } catch (validationError) {
      logger.error({
        message: 'Search submission row failed ingestion validation',
        error: validationError,
      });
      return unavailable();
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return unavailable();
  }
}
