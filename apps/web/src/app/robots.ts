import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { resolveRouteIdentifier } from '@/lib/storefront-route-identifier';

function parseHostHeader(hostHeader: string) {
  try {
    const parsedHost = new URL(`http://${hostHeader}`);
    return {
      requestHostname: parsedHost.hostname.toLowerCase(),
      requestPort: parsedHost.port ? `:${parsedHost.port}` : '',
    };
  } catch {
    return {
      requestHostname: 'localhost',
      requestPort: ':3000',
    };
  }
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers();
  const requestHost = headersList.get('host') || 'localhost:3000';
  const { requestHostname, requestPort } = parseHostHeader(requestHost);
  const legacyBlogHostname = requestHostname.startsWith('blog.')
    ? requestHostname.slice('blog.'.length)
    : null;
  const host = legacyBlogHostname
    ? `${legacyBlogHostname}${requestPort}`
    : `${requestHostname}${requestPort}`;
  const protocol =
    host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
  const storeUrl = `${protocol}://${host}`;

  // Detect if this is a merchant subdomain/custom domain vs the platform domain
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
  ).toLowerCase();
  const normalizedHost = host.split(':')[0].toLowerCase();
  const isPlatformDomain =
    normalizedHost === rootDomain ||
    normalizedHost === `www.${rootDomain}` ||
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1';

  // Merchant storefronts only need minimal disallows (no admin routes exist)
  // Platform domain needs full protection of admin/auth routes
  const disallowedPaths = isPlatformDomain
    ? [
        '/dashboard/',
        '/onboarding/',
        '/_storefront/',
        '/api/',
        '/checkout/',
        '/reset-password/',
        '/auth/',
        '/blog/shopdetail/',
        '/blog/zhHant/',
        '/blog/product/',
        '/blog/category/',
        '/*?*wc-ajax=*',
        '/*?*add-to-cart=*',
      ]
    : [
        // Merchant subdomains/custom domains: only block API and internal paths
        '/api/',
        '/checkout/',
        '/account/login/',
      ];

  // For storefront domains, only advertise /blog/sitemap.xml when the merchant
  // has the blog feature enabled. Otherwise robots.txt points crawlers at a
  // 404 route (all /blog/* pages short-circuit on !blog_enabled), wasting
  // crawl budget and creating SEO trust issues.
  let blogEnabled = false;
  if (!isPlatformDomain) {
    try {
      const routeIdentifier =
        legacyBlogHostname ?? resolveRouteIdentifier(headersList);
      if (routeIdentifier) {
        const merchant = await getMerchantByIdentifier(routeIdentifier);
        if (merchant?.id) {
          blogEnabled = Boolean(merchant.feature_settings?.blog_enabled);
        }
      }
    } catch (error) {
      console.warn('robots.ts: failed to resolve blog feature flag', { error });
    }
  }

  const sitemap = isPlatformDomain
    ? `${storeUrl}/sitemap.xml`
    : blogEnabled
      ? [
          `${storeUrl}/sitemap/static.xml`,
          `${storeUrl}/sitemap/products.xml`,
          `${storeUrl}/sitemap/categories.xml`,
          `${storeUrl}/sitemap/brand-authority.xml`,
          `${storeUrl}/sitemap/commercial-support.xml`,
          `${storeUrl}/blog/sitemap.xml`,
          `${storeUrl}/blog/news-sitemap.xml`,
        ]
      : [
          `${storeUrl}/sitemap/static.xml`,
          `${storeUrl}/sitemap/products.xml`,
          `${storeUrl}/sitemap/categories.xml`,
          `${storeUrl}/sitemap/brand-authority.xml`,
          `${storeUrl}/sitemap/commercial-support.xml`,
        ];

  return {
    rules: [
      // Default rules for all crawlers
      {
        userAgent: '*',
        allow: '/',
        disallow: disallowedPaths,
      },
      // OpenAI ChatGPT Search Bot - allow for AI search visibility
      {
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      // OpenAI ChatGPT User Agent - allow for real-time queries
      {
        userAgent: 'ChatGPT-User',
        allow: '/',
        disallow: disallowedPaths,
      },
      // OpenAI GPTBot - allow for training (opt-in)
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Anthropic Claude Bot
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Anthropic Claude user-requested browsing
      {
        userAgent: 'Claude-User',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Anthropic Claude search indexing
      {
        userAgent: 'Claude-SearchBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Anthropic Claude Web
      {
        userAgent: 'anthropic-ai',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Google Gemini / Bard
      {
        userAgent: 'Google-Extended',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Perplexity AI
      {
        userAgent: 'PerplexityBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Cohere AI
      {
        userAgent: 'cohere-ai',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Meta AI
      {
        userAgent: 'FacebookBot',
        allow: '/',
        disallow: disallowedPaths,
      },
      // Common AI research crawlers
      {
        userAgent: 'CCBot',
        allow: '/',
        disallow: disallowedPaths,
      },
    ],
    sitemap,
  };
}
