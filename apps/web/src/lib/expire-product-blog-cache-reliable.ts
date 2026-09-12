import { expireProductBlogCache } from '@/lib/expire-product-blog-cache';
import { normalizeMerchantId } from '@/lib/normalize-merchant-id';
import { getProductBlogCacheRuntimeConfig } from '@/lib/product-blog-cache-runtime-config';

const DEFAULT_REMOTE_EXPIRY_TIMEOUT_MS = 5_000;

interface ReliableBlogCacheExpiryOptions {
  /** Injectable for tests and worker callers. */
  fetchImpl?: typeof fetch;
  /** Override the web origin used by the standalone-worker fallback. */
  baseUrl?: string;
  /** Override the internal route credential used by the fallback. */
  secret?: string;
  /** Bound the fallback request so cache expiry never blocks a mutation. */
  timeoutMs?: number;
}

/**
 * Hard-expire the related-product enrichment from either a Next request or a
 * standalone worker. `revalidateTag` has no request/store context in the VPS
 * workers, so a failed local attempt is forwarded to the authenticated
 * internal route, where the same merchant-scoped tag is expired in-process.
 */
export async function expireProductBlogCacheReliable(
  merchantId: string,
  options: ReliableBlogCacheExpiryOptions = {}
): Promise<boolean> {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!normalizedMerchantId) return false;

  if (expireProductBlogCache(normalizedMerchantId)) {
    return true;
  }

  let secret: string | undefined;
  let baseUrl: string | undefined;
  try {
    const runtimeConfig = getProductBlogCacheRuntimeConfig();
    secret = options.secret ?? runtimeConfig.secret;
    baseUrl = options.baseUrl ?? runtimeConfig.baseUrl;
  } catch {
    return false;
  }
  if (!secret || !baseUrl) return false;

  try {
    const response = await (options.fetchImpl ?? fetch)(
      new URL('/api/internal/revalidate-products', baseUrl),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchantId: normalizedMerchantId,
          expireProductBlogCache: true,
        }),
        signal: AbortSignal.timeout(
          options.timeoutMs ?? DEFAULT_REMOTE_EXPIRY_TIMEOUT_MS
        ),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}
