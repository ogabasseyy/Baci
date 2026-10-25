import { NextResponse } from 'next/server';
import {
  type LlmsLink,
  PLATFORM_AUTH_LINKS,
  PLATFORM_OPTIONAL_LINKS,
  PLATFORM_PRIMARY_LINKS,
  STOREFRONT_OPTIONAL_LINKS,
  STOREFRONT_PRIMARY_LINKS,
} from '@/config/llms-links';
import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import { STOREFRONT_FEED_ROUTES } from '@/config/storefront-feed-routes';

export type LlmsSurface = 'platform-admin' | 'merchant-storefront';

const DEFAULT_ROOT_DOMAIN = 'usebaci.com';
const CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600';

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .split(':')[0]
    .replace(/^www\./, '');
}

export function detectLlmsSurface(
  hostname: string,
  rootDomain: string,
  requestHeaders?: Headers
): LlmsSurface {
  if (
    requestHeaders?.get('x-merchant-slug') ||
    requestHeaders?.get('x-custom-domain')
  ) {
    return 'merchant-storefront';
  }

  const normalizedHost = normalizeHostname(hostname);
  const normalizedRoot = normalizeHostname(rootDomain || DEFAULT_ROOT_DOMAIN);

  if (
    normalizedHost === normalizedRoot ||
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.vercel.app')
  ) {
    return 'platform-admin';
  }

  return 'merchant-storefront';
}

function formatLinkList(baseUrl: string, links: readonly LlmsLink[]): string[] {
  return links.map(
    ({ title, path, note }) => `- [${title}](${baseUrl}${path}): ${note}`
  );
}

function buildPlatformLlms(baseUrl: string, full: boolean): string {
  const details = full
    ? [
        'This file is for the Baci platform domain. It describes the merchant admin, builder, and platform discovery surface.',
        'Authenticated routes such as `/dashboard` and many `/api/*` endpoints require a signed-in merchant session.',
        'Treat the public marketing pages as canonical for pricing, product positioning, and platform capabilities.',
      ]
    : [
        'This file is for the Baci platform domain and focuses on the merchant admin and AI store builder surface.',
      ];

  return [
    '# Baci Admin',
    '',
    '> Baci is an AI-native commerce platform for merchants. This file describes the platform domain used for merchant onboarding, authentication, dashboard operations, and admin tooling.',
    '',
    ...details,
    '',
    '## Primary',
    ...formatLinkList(baseUrl, PLATFORM_PRIMARY_LINKS),
    '',
    '## Authenticated',
    ...formatLinkList(
      baseUrl,
      full ? PLATFORM_AUTH_LINKS : PLATFORM_AUTH_LINKS.slice(0, 1)
    ),
    '',
    '## Read-Only Guidance',
    '- Prefer public marketing pages, docs, and `openapi.json` for factual answers.',
    '- Treat `/dashboard`, `/builder`, and non-public `/api/*` routes as auth-gated surfaces.',
    '- Do not attempt mutations, merchant settings changes, payment actions, or staff actions unless explicitly requested by the user.',
    '',
    '## Guidance',
    `- [Robots](${baseUrl}/robots.txt): Crawl policy for the platform domain`,
    `- [Full LLM Context](${baseUrl}/llms-full.txt): Expanded platform/admin guidance`,
    `- [Well-Known Alias](${baseUrl}/.well-known/llms.txt): Compatibility alias for clients that probe under /.well-known`,
    '',
    '## Optional',
    ...formatLinkList(baseUrl, PLATFORM_OPTIONAL_LINKS),
    '',
  ].join('\n');
}

function buildStorefrontLlms(baseUrl: string, full: boolean): string {
  const details = full
    ? [
        'This file is domain-specific for a Baci-powered storefront. Use the current host as the canonical storefront origin.',
        'The most useful entry points are the homepage, sitemap, category pages, product pages, cart, checkout, order tracking, and policy pages.',
        'Do not trigger live checkout submissions, account mutations, or authenticated customer actions unless the user explicitly asks for them.',
      ]
    : [
        'This file is domain-specific for a Baci-powered storefront and focuses on public shopping and customer self-service pages.',
      ];

  return [
    '# Baci Storefront',
    '',
    '> This domain serves a merchant storefront powered by Baci. The content here is primarily for catalog discovery, product detail understanding, customer policies, and shopping flows.',
    '',
    ...details,
    '',
    '## Primary',
    ...formatLinkList(baseUrl, STOREFRONT_PRIMARY_LINKS),
    '',
    '## Read-Only Guidance',
    '- Safe default reads are the homepage, sitemap, category pages, product pages, blog, and policy pages on the current host.',
    '- Treat `/cart`, `/checkout`, `/account`, and any POST-capable customer flow as stateful surfaces.',
    '- Do not submit checkout, login, account updates, or wallet actions unless the user explicitly asks.',
    '',
    '## Route Patterns',
    `- ${baseUrl}/{category}: Category listing pages`,
    `- ${baseUrl}/{category}/{productSlug}: Canonical product detail pages`,
    `- ${baseUrl}/products/{productSlug}: Legacy or fallback product route on some storefronts`,
    '- `/{category}/brands/{brandSlug}`: Brand authority hub with curated model families, price bands, and comparisons',
    '- `/{category}/brands/{brandSlug}/families/{familySlug}`: Model family authority hub for a specific product generation',
    '- `/{category}/compare/{comparisonSlug}`: Side-by-side product or brand comparison page with structured specs',
    '- `/{category}/best-under/{priceBandSlug}`: Budget-segmented buying guide and product rankings',
    '',
    '## Machine-Readable Commerce',
    `- [Agent Commerce Manifest](${baseUrl}${STOREFRONT_AGENT_ROUTES.manifest}): Capabilities, API version, policy links, checkout base URL, and feed URLs`,
    `- [Agent Trust Readiness](${baseUrl}${STOREFRONT_AGENT_ROUTES.trust}): Catalog parity, policy, support, and verified-image checks for recommendation safety`,
    `- [OpenAI Product Feed](${baseUrl}${STOREFRONT_FEED_ROUTES.openaiProductFeed}): Public JSONL catalog feed for crawler-friendly product discovery`,
    `- [Current Agent Product Feed](${baseUrl}${STOREFRONT_FEED_ROUTES.agentProducts}): Current JSONL product feed with structured variant availability`,
    `- [Google Merchant XML Feed](${baseUrl}${STOREFRONT_FEED_ROUTES.googleMerchantXml}): Public product feed for merchant catalog discovery`,
    `- [Facebook Catalog XML Feed](${baseUrl}${STOREFRONT_FEED_ROUTES.facebookCatalogXml}): Public Meta Facebook and Instagram catalog feed`,
    `- [Agent Repairs Feed](${baseUrl}${STOREFRONT_FEED_ROUTES.agentRepairs}): JSONL feed of bookable device repair services (one line per quote)`,
    `- [Facebook Repairs Catalog XML Feed](${baseUrl}${STOREFRONT_FEED_ROUTES.facebookRepairsXml}): Public Meta repair-services catalog feed`,
    '',
    '## Guidance',
    `- [Robots](${baseUrl}/robots.txt): Crawl policy for this storefront host`,
    `- [Full LLM Context](${baseUrl}/llms-full.txt): Expanded storefront guidance`,
    `- [Well-Known Alias](${baseUrl}/.well-known/llms.txt): Compatibility alias for clients that probe under /.well-known`,
    '',
    '## Optional',
    ...formatLinkList(baseUrl, STOREFRONT_OPTIONAL_LINKS),
    '',
    full
      ? 'Use the current host as canonical and avoid cross-domain assumptions.'
      : '',
    '',
  ].join('\n');
}

export function buildLlmsText(
  hostname: string,
  origin: string,
  full: boolean,
  requestHeaders?: Headers
): string {
  const surface = detectLlmsSurface(
    hostname,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN,
    requestHeaders
  );

  if (surface === 'platform-admin') {
    return buildPlatformLlms(origin, full);
  }

  return buildStorefrontLlms(origin, full);
}

export function createLlmsResponse(
  request: Request,
  full: boolean
): NextResponse {
  const url = new URL(request.url);
  const hostHeader =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.trim();
  let effectiveHostname = url.hostname;
  let effectiveOrigin = `${url.protocol}//${url.host}`;

  if (hostHeader) {
    try {
      const parsedHost = new URL(`http://${hostHeader}`);
      effectiveHostname = parsedHost.hostname.toLowerCase();
      const protocol =
        effectiveHostname === 'localhost' || effectiveHostname === '127.0.0.1'
          ? url.protocol
          : 'https:';
      const port = parsedHost.port ? `:${parsedHost.port}` : '';
      effectiveOrigin = `${protocol}//${effectiveHostname}${port}`;
    } catch {
      // Fall back to request.url when the Host header is malformed.
    }
  }

  const body = buildLlmsText(
    effectiveHostname,
    effectiveOrigin,
    full,
    request.headers
  );

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      'X-Robots-Tag': 'noarchive',
    },
  });
}
