import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import type { CachedMerchant } from '@/lib/cached-data';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  isLocalhost,
  isPlatformHost,
  normalizeHostname,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { BOT_USER_AGENT_REGEX } from '@/lib/proxy/routing-constants';
import { searchStorefrontProducts } from '@/lib/storefront-search';
import { createClient } from '@/lib/supabase/server';
import { searchSubmissionSchema } from '@/schemas/search-submission';

function unavailable() {
  return NextResponse.json(
    { error: 'Search tracking unavailable' },
    { status: 503 }
  );
}

/**
 * Public, best-effort telemetry. The proxy applies the dedicated per-IP budget.
 *
 * No double-submit CSRF token by design: this endpoint is unauthenticated
 * public analytics in the same class as /api/platform/events (exempt in
 * checkCsrfProtection), and storefront pages do not mint CSRF cookies
 * (CsrfInitializer mounts only in admin/dashboard/builder), so token
 * enforcement would reject every legitimate submission. Cross-site forgery is
 * instead blocked by the strict same-Origin check below — browsers always send
 * Origin on fetch/form POSTs, and a missing or mismatched Origin is a 403 —
 * plus bot-UA filtering, a bounded body, Zod validation, and the per-IP
 * budget. The worst case for a forged same-shape request is a polluted
 * analytics count; no privileged state is reachable here.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const requestHost = request.headers.get('host') || request.nextUrl.host;
  try {
    const originUrl = new URL(origin || '');
    if (
      originUrl.host !== requestHost ||
      originUrl.protocol !== request.nextUrl.protocol
    ) {
      return NextResponse.json(
        { error: 'Cross-origin request blocked' },
        { status: 403 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid Origin header' },
      { status: 403 }
    );
  }

  const userAgent = request.headers.get('user-agent') || '';
  if (
    !userAgent ||
    BOT_USER_AGENT_REGEX.test(userAgent) ||
    /curl|wget|python-requests|headlesschrome/i.test(userAgent)
  ) {
    return new NextResponse(null, { status: 204 });
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
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
    const { error } = await supabase.from('search_analytics').insert({
      merchant_id: merchant.id,
      search_query: result.query,
      results_count: result.count,
      search_method: 'client',
    });
    if (error) return unavailable();
    return new NextResponse(null, { status: 204 });
  } catch {
    return unavailable();
  }
}
