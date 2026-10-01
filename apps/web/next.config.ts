import path from 'node:path';
import { withPostHogConfig } from '@posthog/nextjs-config';
import type { NextConfig } from 'next';
import { builderPreviewRouteHeaders } from './src/config/builder-preview-route-headers';
import { CACHE_LIFE_PROFILES } from './src/config/cache-life-profiles';
import { OGABASSEY_DOCUMENT_LINK_HEADER_VALUE } from './src/config/early-hints-link-header';
import { applyNextDeploymentIdEnv } from './src/config/next-deployment-id';
import { IMMUTABLE_NEXT_STATIC_ASSET_HEADERS } from './src/config/next-static-asset-headers';
import { STATIC_GENERATION_LIMITS } from './src/config/static-generation';
import {
  STOREFRONT_METADATA_BLOCKING_BOT_USER_AGENT_REGEX,
  STOREFRONT_METADATA_CACHE_BUCKET_HEADER,
} from './src/config/storefront-metadata-cache-bots';
import {
  getPostHogAssetsHost,
  getPostHogIngestHost,
  getPostHogProxyPath,
  getPostHogPublicBuildEnv,
  getPostHogReleaseVersion,
  getPostHogUiHost,
  isPostHogSourceMapUploadEnabled,
} from './src/lib/posthog/config';

// Keep this as an explicit static-asset suffix list. A generic dotted-path
// exclusion drops valid HTML routes such as `/products/iphone-v1.2`.
const HTML_DOCUMENT_STATIC_FILE_EXTENSION_PATTERN =
  '.*\\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|png|svg|ttf|txt|webmanifest|webp|woff2?|xml)$';
const HTML_DOCUMENT_ROUTE_SOURCE = `/((?!api(?:/|$)|_next(?:/|$)|${HTML_DOCUMENT_STATIC_FILE_EXTENSION_PATTERN}).*)`;
const STOREFRONT_METADATA_VARY_HEADER_VALUE = [
  STOREFRONT_METADATA_CACHE_BUCKET_HEADER,
  'rsc',
  'next-router-state-tree',
  'next-router-prefetch',
  'next-router-segment-prefetch',
].join(', ');
const OGABASSEY_DOMAIN = 'ogabassey.com';
const OGABASSEY_WWW_DOMAIN = `www.${OGABASSEY_DOMAIN}`;
const OGABASSEY_DOCUMENT_HOST_MATCHER = `(?:www\\.)?${OGABASSEY_DOMAIN.replaceAll(
  '.',
  '\\.'
)}`;
const OGABASSEY_REDIRECT_HOST_MATCHERS = [
  OGABASSEY_DOMAIN.replaceAll('.', '\\.'),
  OGABASSEY_WWW_DOMAIN.replaceAll('.', '\\.'),
] as const;
const OGABASSEY_NON_PDP_FIRST_SEGMENT_PATTERN = [
  'about',
  'account',
  'admin',
  'api',
  'auth',
  'blog',
  'cart',
  'checkout',
  'contact',
  'dashboard',
  'faq',
  'favicon',
  'imei-check',
  'llms',
  'manifest',
  'mcp',
  'orders',
  'privacy',
  'repairs',
  'returns',
  'robots',
  'search',
  'shipping',
  'sitemap',
  'terms',
  'wallet',
  'warranty',
].join('|');
const OGABASSEY_PDP_DOCUMENT_ROUTE_SOURCE = `/:category((?!(?:${OGABASSEY_NON_PDP_FIRST_SEGMENT_PATTERN})(?:/|$))[^/]+)/:productSlug([a-zA-Z0-9-]+)`;
const OGABASSEY_GENERIC_DOCUMENT_ROUTE_SOURCE = `/:path((?!(?:(?!(?:${OGABASSEY_NON_PDP_FIRST_SEGMENT_PATTERN})(?:/|$))[^/]+/[^/]+/?$)).*)`;
// The OgaBassey document `Link` header carries a media-CDN `preconnect` (Ops-2 /
// 103 Early Hints) alongside the agent-discovery links — see
// src/config/early-hints-link-header.ts. PDP LCP image PRELOADS stay OUT: an HTTP
// Link header cannot carry responsive `imagesrcset` selection, and a fixed
// preload previously triggered a wasteful mobile-header image fetch that competed
// with the real LCP (the page emits imageSrcSet/imageSizes preloads instead).
const OGABASSEY_PDP_LINK_HEADER_VALUE = OGABASSEY_DOCUMENT_LINK_HEADER_VALUE;
const POSTHOG_SOURCE_MAP_API_KEY = process.env.POSTHOG_API_KEY?.trim();
const POSTHOG_SOURCE_MAP_PROJECT_ID = process.env.POSTHOG_PROJECT_ID?.trim();
const POSTHOG_SOURCE_MAP_UPLOAD_ENABLED = isPostHogSourceMapUploadEnabled();
const NEXT_DEPLOYMENT_ID = applyNextDeploymentIdEnv();
const POSTHOG_PUBLIC_BUILD_ENV = getPostHogPublicBuildEnv();

function getPostHogRewriteRules() {
  const proxyPath = getPostHogProxyPath();
  const assetsHost = getPostHogAssetsHost();
  const ingestHost = getPostHogIngestHost();

  return [
    {
      source: `${proxyPath}/static/:path*`,
      destination: `${assetsHost}/static/:path*`,
    },
    {
      source: `${proxyPath}/array/:path*`,
      destination: `${assetsHost}/array/:path*`,
    },
    {
      source: `${proxyPath}/:path*`,
      destination: `${ingestHost}/:path*`,
    },
  ];
}

const nextConfig: NextConfig = {
  deploymentId: NEXT_DEPLOYMENT_ID,
  env: POSTHOG_PUBLIC_BUILD_ENV,

  // Keep heavy server-only packages external to reduce function bundle size and peak memory.
  // jsPDF stays external here so server PDF generators can use the package
  // entrypoint without Turbopack bundling fflate's worker path into app code.
  // These packages are only used in specific API routes and should not be bundled into every function.
  serverExternalPackages: [
    'jspdf',
    'jspdf-autotable',
    'sharp',
    'expo-server-sdk',
  ],

  // Enable React Compiler for automatic memoization (Next.js 16 stable)
  // Reduces unnecessary re-renders without manual useMemo/useCallback
  reactCompiler: true,

  // Let proxy.ts keep legacy webhook paths compatible while preserving the
  // normal no-trailing-slash policy for the rest of the app.
  skipTrailingSlashRedirect: true,

  // Production source maps disabled to save ~1-2 min build time
  // Re-enable if needed for debugging: productionBrowserSourceMaps: true,
  productionBrowserSourceMaps: false,

  // Enable 'use cache' directive for Dynamic IO (Next.js 16)
  cacheComponents: true,

  // Keep Next's origin metadata mode synchronized with proxy.ts cache buckets.
  // With PPR/cacheComponents, Next blocks streaming metadata for DOM bots such
  // as Googlebot as well as HTML-limited bots; using the shared classifier
  // avoids rendering streamed metadata for normal browser requests.
  htmlLimitedBots: STOREFRONT_METADATA_BLOCKING_BOT_USER_AGENT_REGEX,

  // Application-owned remote cache handler (PR 4 — remote cache isolation and
  // failure safety).
  //
  // Every `'use cache: remote'` site previously rode Next's DEFAULT remote
  // handler, whose failed `set()` becomes an unhandled rejection and kills the
  // process with `exit 128` AFTER the HTTP 200 has already been sent
  // (vercel/next.js#94751). This adapter WRAPS the platform's shared store — it
  // does not replace it, because every remaining site has a live `revalidateTag`
  // contract that only propagates cross-instance through the shared store.
  //
  // Contract: failed get() => miss; failed set() => resolves quietly; oversized
  // items refused; circuit breaker on a sick backend; bounded-label telemetry.
  //
  // Must stay a Node-resolvable `.mjs`: Next `require.resolve()`s this path at
  // build-trace time and imports it via `pathToFileURL()` at runtime, so it is
  // never passed through the bundler and cannot be TypeScript.
  cacheHandlers: {
    remote: path.resolve(__dirname, 'src/lib/cache/remote-cache-handler.mjs'),
  },

  // Custom cache profiles for 'use cache' + cacheLife()
  // Mutations target tags/paths; these profiles bound delayed or missed
  // invalidation while reducing repeat rendering and cache writes.
  cacheLife: CACHE_LIFE_PROFILES,

  // Fix Vercel middleware tracing issue with Next.js 16
  // See: https://github.com/vercel/next.js/issues/71818
  outputFileTracingIncludes: {
    '/middleware': ['./node_modules/@supabase/**/*'],
  },

  images: {
    // Custom loader bypasses Vercel's /_next/image proxy entirely.
    // Cloudflare WAF blocks Vercel's server-side fetches (OPTIMIZED_EXTERNAL_IMAGE_REQUEST_UNAUTHORIZED).
    // Since all merchant images are pre-optimized AVIF on CDNs, re-optimization is redundant.
    // Local public assets therefore keep their direct URL instead of delegating
    // back into the default image optimizer pipeline.
    loader: 'custom',
    loaderFile: './src/lib/image-loader.ts',
    // Next's default deviceSizes jump 1200 → 1920, so any 100vw image on a
    // DPR≥2.6 phone (e.g. 393px viewport × 3 = 1179 → next bucket up) selects
    // the 1920w candidate and over-fetches 25–33% (measured 7–16KB waste per
    // image). The added 1440 tier gives those viewports an exact-fit bucket.
    deviceSizes: [640, 750, 828, 1080, 1200, 1440, 1920, 2048, 3840],
    // Note: remotePatterns are effectively documentation here. The custom
    // loader returns final URLs directly, so Next's default optimizer and
    // its remotePatterns enforcement are not on the request path.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'plus.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'loremflickr.com',
      },
      {
        // Placeholder images for development/previews
        protocol: 'https',
        hostname: 'picsum.photos',
      },
      {
        // Placeholder images for development/previews
        protocol: 'https',
        hostname: 'placehold.co',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'cloudflare-ipfs.com',
      },
      {
        protocol: 'https',
        hostname: 'd1csarkz8obe9u.cloudfront.net',
      },
      {
        protocol: 'https',
        hostname: 'cdn.ogabassey.com',
      },
      {
        protocol: 'https',
        hostname: 'ogabassey.com',
      },
      {
        // YouTube video thumbnails for blog video previews
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        // Supabase storage for merchant images
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
      {
        // Google static content (logos, icons)
        protocol: 'https',
        hostname: 'www.gstatic.com',
      },
      {
        // Apple CDN for product images (store previews)
        protocol: 'https',
        hostname: 'store.storeimages.cdn-apple.com',
      },
      {
        // Common data storage (sample videos)
        protocol: 'https',
        hostname: 'commondatastorage.googleapis.com',
      },
      {
        // GSMArena CDN for device/phone images
        protocol: 'https',
        hostname: 'fdn.gsmarena.com',
      },
      {
        // GSMArena CDN for device/phone images
        protocol: 'https',
        hostname: 'fdn2.gsmarena.com',
      },
      {
        // XDA Developers images (common in blog posts)
        protocol: 'https',
        hostname: 'static0.xdaimages.com',
      },
      {
        // XDA Developers images
        protocol: 'https',
        hostname: 'www.xda-developers.com',
      },
      {
        // Placeholder images for legacy tests
        protocol: 'https',
        hostname: 'via.placeholder.com',
      },
    ],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // Optimize image formats - AVIF is 20% smaller than WebP
    formats: ['image/avif', 'image/webp'],
    qualities: [35, 50, 60, 70, 75, 80, 85, 90, 100],
    // Cache optimized images (Next.js 16 default is 4 hours / 14400s)
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },

  experimental: {
    ...STATIC_GENERATION_LIMITS,

    // SRI (Subresource Integrity) temporarily disabled
    // Causes ENOENT subresource-integrity-manifest.json in Vercel CLI deploys
    // Re-enable when Vercel monorepo support for SRI is stable
    // sri: {
    //   algorithm: 'sha256',
    // },

    // Keep CSS external. The inlineCss experiment inflated the streamed
    // storefront HTML/RSC payload on ogabassey.com and duplicated large
    // Tailwind/global CSS chunks in the initial document.
    inlineCss: false,

    // Note: optimizeCss is disabled as it relies on Critters and is
    // incompatible with App Router streaming. Use stable CSS pipeline instead.

    // Server Actions configuration
    serverActions: {
      bodySizeLimit: '2mb',
    },

    // TypeScript 7 has no JavaScript compiler API. Keep Next on its CLI path
    // while the repository retains TypeScript 6 solely for API consumers.
    useTypeScriptCli: true,

    // Bundle optimization - tree-shake large libraries
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'date-fns',
      'framer-motion',
      '@radix-ui/react-icons',
      'lodash-es',
      '@supabase/supabase-js',
    ],

    // Enable Turbopack file system caching for faster dev rebuilds (Next.js 16)
    // Caches compilation results to disk, dramatically reducing rebuild times
    turbopackFileSystemCacheForDev: true,
  },

  // Enable typed routes for compile-time validation of Link hrefs
  typedRoutes: true,

  // Turbopack resolve alias (Next.js 16 default bundler)
  // Maps @tiptap/extension-text-style to compat shim that re-exports
  // v3 named exports with a legacy default export for Novel
  turbopack: {
    resolveAlias: {
      // Relative path required — Turbopack doesn't support absolute paths in resolveAlias
      '@tiptap/extension-text-style':
        './src/lib/tiptap-extension-text-style-compat.ts',
    },
  },

  // Webpack fallback alias (used when building with --webpack flag)
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@tiptap/extension-text-style$': path.resolve(
        __dirname,
        'src/lib/tiptap-extension-text-style-compat.ts'
      ),
    };

    return config;
  },

  // SEO redirects - flat URL structure for legal pages + legacy WordPress URLs
  redirects() {
    return Promise.resolve([
      // === SEO-FRIENDLY LEGAL PAGE REDIRECTS ===
      // Redirect old /pages/* URLs to new flat structure
      {
        source: '/:slug/pages/terms',
        destination: '/:slug/terms',
        permanent: true, // 301 redirect
      },
      {
        source: '/:slug/pages/privacy',
        destination: '/:slug/privacy',
        permanent: true,
      },
      {
        source: '/:slug/pages/about',
        destination: '/:slug/about',
        permanent: true,
      },
      {
        source: '/:slug/pages/faq',
        destination: '/:slug/faq',
        permanent: true,
      },
      {
        source: '/:slug/pages/contact',
        destination: '/:slug/contact',
        permanent: true,
      },
      // Redirect legacy verbose URLs to short versions
      {
        source: '/:slug/terms-of-service',
        destination: '/:slug/terms',
        permanent: true,
      },
      {
        source: '/:slug/privacy-policy',
        destination: '/:slug/privacy',
        permanent: true,
      },
      // === CONTENT REDIRECTS (Ahrefs Fixes) ===
      // Renamed blog posts
      {
        source: '/blog/iphone-xr-in-2025-is-this-still-a-good-deal',
        destination:
          '/blog/moving-on-from-iphone-xr-in-2025-heres-what-to-buy-next',
        permanent: true,
      },
      {
        source:
          '/blog/why-the-samsung-galaxy-s21-ultra-is-still-a-top-pick-in-2024',
        destination:
          '/blog/samsung-galaxy-s21-ultra-in-2025-powerful-enough-or-just-hanging-on',
        permanent: true,
      },
      // Imported slug contained an encoded non-breaking hyphen. Keep old
      // links valid while routing cacheable requests through its ASCII slug.
      {
        source:
          '/blog/wwdc-2025-5-game%e2%80%91changing-apple-announcements/:path*',
        destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
        permanent: true,
      },
      {
        source:
          '/blog/2025/06/10/wwdc-2025-5-game%e2%80%91changing-apple-announcements/:path*',
        destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
        permanent: true,
      },
      // This imported slug used non-breaking hyphens after WWDC and 2025.
      // Redirect both URL-encoded forms before remote cache key handling.
      {
        source:
          '/blog/wwdc%e2%80%912025%e2%80%915-game-changing-apple-announcements/:path*',
        destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
        permanent: true,
      },
      {
        source:
          '/blog/wwdc%25e2%2580%25912025%25e2%2580%25915-game-changing-apple-announcements/:path*',
        destination: '/blog/wwdc-2025-5-game-changing-apple-announcements',
        permanent: true,
      },
      // Off-topic imported posts retired from the public tech blog.
      ...OGABASSEY_REDIRECT_HOST_MATCHERS.flatMap((hostMatcher) => [
        {
          source:
            '/blog/abubakar-malami-remanded-former-nigerian-agf-faces-multi-billion-naira-property-charges',
          destination: '/blog',
          permanent: true,
          has: [{ type: 'host' as const, value: hostMatcher }],
        },
        {
          source:
            '/blog/cbn-forecast-nigerias-external-reserves-projected-to-hit-5104-billion-by-2026',
          destination: '/blog',
          permanent: true,
          has: [{ type: 'host' as const, value: hostMatcher }],
        },
      ]),
      // Note: legacy WordPress category permalink redirects (/blog/:legacyCategory/:postSlug)
      // and thumbnail_id query-string stripping are owned by apps/web/src/proxy.ts
      // (single source of truth, also handles /blog/wp-admin 410s). Do not re-add here to
      // avoid redirect chains / competing rules.
      // Fix specific product suffix issues
      {
        source: '/phones/iphone-x-3gb-64gb-nfid',
        destination: '/phones/iphone-x-3gb-64gb',
        permanent: true,
      },
      // === CATEGORY REDIRECTS (Meta Refresh Fix) ===
      // Redirect legacy category paths to canonical URLs (scoped to ogabassey.com)
      {
        source: '/macbook',
        destination: '/laptops',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/macbook/:path*',
        destination: '/laptops/:path*',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/samsung',
        destination: '/smartphones',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/samsung/:path*',
        destination: '/smartphones/:path*',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/phones',
        destination: '/smartphones',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/phones/:path*',
        destination: '/smartphones/:path*',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/oppo',
        destination: '/oppo-phones',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },
      {
        source: '/oppo/:path*',
        destination: '/oppo-phones/:path*',
        permanent: true,
        has: [{ type: 'host', value: OGABASSEY_DOMAIN }],
      },

      // === LEGACY WORDPRESS URL REDIRECTS (GSC Fix) ===
      // /user/* paths - redirect to homepage
      {
        source: '/user/:path*',
        destination: '/',
        permanent: true,
      },
      // /home/* paths - redirect to homepage
      {
        source: '/home/:path*',
        destination: '/',
        permanent: true,
      },
      // /product-category/* — WordPress-era category URLs. Known WP categories
      // map to their live category pages; anything else falls through to the
      // product index. Destinations must be public single-hop paths — the
      // previous '/ogabassey/products' target leaked the internal
      // slug-prefixed path and chained through the merchant-prefix collapse
      // redirect in proxy.ts.
      //
      // Host-scoped to both apex and www via OGABASSEY_REDIRECT_HOST_MATCHERS
      // (same pattern as the off-topic blog redirects above) so www legacy
      // links resolve in one hop rather than depending on an upstream www→apex
      // redirect. Scoping matters for the /products fallbacks specifically:
      // `products` is a PLATFORM_ROOT_ROUTE_SEGMENT with no top-level route, so
      // an unscoped redirect would 404 on a slug-prefixed platform/preview host
      // instead of falling through to that host's normal handling.
      //
      // The `:path*` suffix (zero-or-more segments) folds WP pagination and
      // nested variants — e.g. /product-category/smartwatches/page/2 — onto the
      // category root in a single hop instead of dropping them to the generic
      // /products fallback, mirroring the exact+wildcard pairing the sibling
      // /macbook, /samsung, /phones rules use above.
      ...OGABASSEY_REDIRECT_HOST_MATCHERS.flatMap((hostMatcher) => [
        ...['accessories', 'headphones', 'smartwatches'].map(
          (categorySlug) => ({
            source: `/product-category/${categorySlug}/:path*`,
            destination: `/${categorySlug}`,
            permanent: true,
            has: [{ type: 'host' as const, value: hostMatcher }],
          })
        ),
        {
          source: '/product-category/:path*',
          destination: '/products',
          permanent: true,
          has: [{ type: 'host' as const, value: hostMatcher }],
        },
        // /category/product/:id - legacy product URLs
        {
          source: '/category/product/:id',
          destination: '/products',
          permanent: true,
          has: [{ type: 'host' as const, value: hostMatcher }],
        },
      ]),
    ]);
  },

  // Proxy MCP requests to VPS (only if MCP_SERVER_URL is configured)
  rewrites() {
    const mcpServerUrl = process.env.MCP_SERVER_URL;
    const beforeFiles = [
      ...getPostHogRewriteRules(),
      {
        source: '/',
        has: [
          {
            type: 'header',
            key: 'accept',
            value: '(?<accept>.*text/markdown.*)',
          },
        ],
        destination: '/llms-full.txt',
      },
      {
        source:
          '/:storefrontIdentifier((?!(?:auth\\.md|openapi\\.json|agent-commerce\\.json|agent-trust\\.json|llms\\.txt|llms-full\\.txt|robots\\.txt|api|_next|\\.well-known)(?:$|/)).+)',
        has: [
          {
            type: 'header',
            key: 'accept',
            value: '(?<accept>.*text/markdown.*)',
          },
        ],
        destination: '/llms-full.txt',
      },
      {
        source: '/robots.txt',
        destination: '/api/robots',
      },
      {
        source: '/blog/sitemap.xml',
        destination: '/sitemap/blog.xml',
      },
    ];

    if (!mcpServerUrl) {
      return { beforeFiles };
    }
    return {
      beforeFiles,
      afterFiles: [
        {
          source: '/mcp/sse',
          destination: `${mcpServerUrl}/sse`,
        },
        {
          source: '/mcp/messages',
          destination: `${mcpServerUrl}/messages`,
        },
      ],
    };
  },

  // Security headers
  headers() {
    return [
      ...builderPreviewRouteHeaders,
      {
        source: HTML_DOCUMENT_ROUTE_SOURCE,
        headers: [
          {
            key: 'Vary',
            // Exclude static/API paths, but allow dotted custom-domain rewrite
            // segments like /ogabassey.com/products to receive the HTML Vary.
            value: STOREFRONT_METADATA_VARY_HEADER_VALUE,
          },
        ],
      },
      ...(process.env.NODE_ENV === 'production'
        ? [IMMUTABLE_NEXT_STATIC_ASSET_HEADERS]
        : []),
      {
        source: OGABASSEY_GENERIC_DOCUMENT_ROUTE_SOURCE,
        has: [{ type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER }],
        headers: [
          {
            key: 'Link',
            value: OGABASSEY_DOCUMENT_LINK_HEADER_VALUE,
          },
        ],
      },
      {
        source: OGABASSEY_PDP_DOCUMENT_ROUTE_SOURCE,
        has: [{ type: 'host', value: OGABASSEY_DOCUMENT_HOST_MATCHER }],
        headers: [
          {
            key: 'Link',
            value: OGABASSEY_PDP_LINK_HEADER_VALUE,
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
          },
          // Note: COEP is set selectively in proxy.ts (middleware)
          // to allow Google Ads on storefront while protecting admin routes
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups',
          },
        ],
      },
    ];
  },
};

function applyPostHogConfig(config: NextConfig): NextConfig {
  if (
    !POSTHOG_SOURCE_MAP_UPLOAD_ENABLED ||
    !POSTHOG_SOURCE_MAP_API_KEY ||
    !POSTHOG_SOURCE_MAP_PROJECT_ID
  ) {
    return config;
  }

  return withPostHogConfig(config, {
    personalApiKey: POSTHOG_SOURCE_MAP_API_KEY,
    projectId: POSTHOG_SOURCE_MAP_PROJECT_ID,
    host: getPostHogUiHost(),
    sourcemaps: {
      enabled: true,
      releaseName: 'baci-web',
      releaseVersion: getPostHogReleaseVersion(),
      deleteAfterUpload: true,
    },
  });
}

export default applyPostHogConfig(nextConfig);
