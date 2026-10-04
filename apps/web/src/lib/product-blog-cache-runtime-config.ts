import 'server-only';

function readRuntimeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Reads only the runtime values needed by the standalone blog-cache fallback.
 * This deliberately does not import `@/env`: the cache scheduler is reachable
 * from ordinary API routes and must not pull the broad credential authority
 * module into the event-pipeline import graph.
 */
export function getProductBlogCacheRuntimeConfig(): {
  baseUrl: string;
  secret?: string;
} {
  return {
    baseUrl:
      readRuntimeValue(process.env.BACI_WEB_BASE_URL) ??
      readRuntimeValue(process.env.NEXT_PUBLIC_APP_URL) ??
      'http://localhost:3000',
    secret: readRuntimeValue(process.env.INTERNAL_API_SECRET),
  };
}
