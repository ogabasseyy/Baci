import { type NextRequest, NextResponse } from 'next/server';
import {
  MerchantNotFoundError,
  resolveFeedMerchant,
} from '@/lib/feed-identifier';
import { createAnonClient } from '@/lib/supabase/anon';

const DEFAULT_ROOT_DOMAIN = 'usebaci.com';
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MANAGED_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeHost(rawHost: string | null): string | null {
  if (!rawHost) {
    return null;
  }

  const firstHost = rawHost.split(',')[0]?.trim().toLowerCase();
  if (!firstHost) {
    return null;
  }

  return firstHost.replace(/:\d+$/, '');
}

function isSafeHostname(host: string): boolean {
  return HOSTNAME_PATTERN.test(host);
}

function getRootDomain(): string {
  const configuredRootDomain = normalizeHost(
    process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? null
  );

  return configuredRootDomain && isSafeHostname(configuredRootDomain)
    ? configuredRootDomain
    : DEFAULT_ROOT_DOMAIN;
}

function getManagedMerchantSlug(host: string): string | null {
  const rootDomain = getRootDomain();

  if (host === rootDomain || host === `www.${rootDomain}`) {
    return null;
  }

  if (!host.endsWith(`.${rootDomain}`)) {
    return null;
  }

  const candidate = host.slice(0, -`.${rootDomain}`.length);
  return candidate && MANAGED_SLUG_PATTERN.test(candidate) ? candidate : null;
}

interface LegacyFeedTarget {
  merchantSlug: string;
}

async function resolveLegacyFeedTarget(
  host: string
): Promise<LegacyFeedTarget> {
  const managedSlug = getManagedMerchantSlug(host);
  if (managedSlug) {
    const merchant = await resolveFeedMerchant(managedSlug, true);
    return {
      merchantSlug: merchant.slug,
    };
  }

  const supabase = createAnonClient();
  const { data: domain, error } = await supabase
    .from('domains')
    .select('merchant_id, domain')
    .eq('domain', host)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw new Error('Failed to resolve merchant domain', { cause: error });
  }

  const verifiedHost = normalizeHost(domain?.domain ?? null);

  if (
    !domain?.merchant_id ||
    !verifiedHost ||
    verifiedHost !== host ||
    !isSafeHostname(verifiedHost)
  ) {
    throw new MerchantNotFoundError(host);
  }

  const merchant = await resolveFeedMerchant(domain.merchant_id, false);
  return {
    merchantSlug: merchant.slug,
  };
}

/**
 * Legacy Google Merchant feed route.
 * Redirects old integrations to the canonical public feed endpoint.
 */
export async function GET(request: NextRequest) {
  const host = normalizeHost(
    request.headers.get('host') ??
      request.headers.get('x-forwarded-host') ??
      new URL(request.url).host
  );

  if (!host) {
    return NextResponse.json(
      { error: 'Unable to resolve merchant for legacy feed URL' },
      { status: 400 }
    );
  }

  try {
    const target = await resolveLegacyFeedTarget(host);
    // Feed lookup accepts merchant_slug independently of the request host.
    // Keep every legacy redirect on the server-configured Baci origin; an
    // active custom domain must never become redirect authority from headers.
    const merchantSlug = encodeURIComponent(target.merchantSlug);
    const redirectUrl = new URL(
      `/api/feed/google-merchant?merchant_slug=${merchantSlug}`,
      `https://${getRootDomain()}`
    );

    return NextResponse.redirect(redirectUrl, 308);
  } catch (error) {
    console.error('LEGACY_GMC_FEED_REDIRECT_ERROR:', error);

    if (error instanceof MerchantNotFoundError) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to resolve merchant for legacy feed URL' },
      { status: 500 }
    );
  }
}
