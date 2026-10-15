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
  redirectHost: string;
}

/**
 * Defence-in-depth: enforce a closed allow-list on the redirect host AFTER
 * resolution. The host must be either:
 *   1. The configured root domain or one of its subdomains (managed flow), OR
 *   2. The exact hostname returned by an active row in the `domains` table
 *      (custom-domain flow).
 *
 * This is paranoid by design — the upstream resolution already filters input,
 * but anchoring the redirect to a closed allow-list here protects against
 * regressions and silences static analyzers (Semgrep `open-redirect`) that
 * cannot follow the data flow through the DB.
 */
function isAllowedRedirectHost(
  host: string,
  options: { managedRoot?: string; verifiedDbHost?: string }
): boolean {
  if (!isSafeHostname(host)) {
    return false;
  }

  const { managedRoot, verifiedDbHost } = options;

  if (managedRoot) {
    if (host === managedRoot) {
      return true;
    }
    if (host.endsWith(`.${managedRoot}`)) {
      return true;
    }
  }

  if (verifiedDbHost && host === verifiedDbHost) {
    return true;
  }

  return false;
}

async function resolveLegacyFeedTarget(
  host: string
): Promise<LegacyFeedTarget> {
  const managedSlug = getManagedMerchantSlug(host);
  if (managedSlug) {
    const merchant = await resolveFeedMerchant(managedSlug, true);
    const rootDomain = getRootDomain();
    const redirectHost = `${merchant.slug}.${rootDomain}`;

    if (!isAllowedRedirectHost(redirectHost, { managedRoot: rootDomain })) {
      throw new MerchantNotFoundError(host);
    }

    return {
      merchantSlug: merchant.slug,
      redirectHost,
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

  if (!domain?.merchant_id || !verifiedHost || !isSafeHostname(verifiedHost)) {
    throw new MerchantNotFoundError(host);
  }

  if (!isAllowedRedirectHost(verifiedHost, { verifiedDbHost: verifiedHost })) {
    throw new MerchantNotFoundError(host);
  }

  const merchant = await resolveFeedMerchant(domain.merchant_id, false);
  return {
    merchantSlug: merchant.slug,
    redirectHost: verifiedHost,
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
    // SAFE: `target.redirectHost` is constrained by `isAllowedRedirectHost`
    // inside `resolveLegacyFeedTarget` — it is either a `${slug}.<rootDomain>`
    // for the managed flow or the exact `domain` column of an active row in
    // the `domains` table for custom domains. Any other value throws
    // `MerchantNotFoundError`. Request input cannot drive the authority.
    const redirectUrl = new URL(
      '/api/feed/google-merchant',
      `https://${target.redirectHost}`
    );
    redirectUrl.searchParams.set('merchant_slug', target.merchantSlug);

    // FP: redirect authority is allowlisted by isAllowedRedirectHost (throws otherwise); request input selects among allowed hosts only. Dismissed in code-scanning (false-positive).
    // nosemgrep: javascript.express.open-redirect-deepsemgrep.open-redirect-deepsemgrep
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
