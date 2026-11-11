import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantFeatureSource } from '@/lib/merchant-has-feature';
import { SingleFlight } from '@/lib/single-flight';
import { storefrontAuthMerchantRpcRowSchema } from '@/schemas/storefront-auth-merchant';
import { createAnonMerchantFeatureLookup } from './merchant-resolution';
import type {
  MerchantRpcClient,
  ResolveCartMerchantDeps,
} from './merchant-resolution-types';

/**
 * How long one warm instance may reuse a merchant's published mapping and
 * feature row. Unpublishing a store or removing `shared_cart` therefore
 * reaches the hot cart routes within this window, not instantly.
 */
export const CART_MERCHANT_LOOKUP_TTL_MS = 30_000;
const MAX_ENTRIES = 500;

type FeatureLookup = NonNullable<
  ResolveCartMerchantDeps['loadMerchantFeatures']
>;
type RpcReply = { data: unknown; error: unknown };

interface Entry<T> {
  value: T;
  writtenAt: number;
}

function createTtlCache<T>() {
  const entries = new Map<string, Entry<T>>();
  return {
    clear: () => entries.clear(),
    get(key: string, now: number): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now - entry.writtenAt < CART_MERCHANT_LOOKUP_TTL_MS) {
        return entry.value;
      }
      entries.delete(key);
      return undefined;
    },
    set(key: string, value: T, now: number) {
      if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { value, writtenAt: now });
    },
  };
}

// Public merchant data only (id, slug, domain, published flag, plan and
// feature fields): nothing here is shopper- or session-specific, so one
// process-wide cache is safe to share between requests.
const merchantRows = createTtlCache<unknown>();
const featureRows = createTtlCache<MerchantFeatureSource>();
const merchantReads = new SingleFlight<RpcReply>();
const featureReads = new SingleFlight<MerchantFeatureSource | null>();

/** Only a published, well-formed merchant row is worth remembering. */
function cacheableMerchantReply(reply: RpcReply): boolean {
  if (reply.error) return false;
  const row = Array.isArray(reply.data) ? reply.data[0] : null;
  const parsed = storefrontAuthMerchantRpcRowSchema.safeParse(row);
  return parsed.success && parsed.data.is_published;
}

/**
 * Merchant resolution and enrollment lookups for the hot cart routes
 * (snapshot read and commands), remembered per warm instance for
 * {@link CART_MERCHANT_LOOKUP_TTL_MS}. Misses, errors, unpublished stores
 * and missing feature rows are never cached, so a store that becomes
 * available is picked up on the next request. Concurrent identical reads
 * share one round trip.
 */
export function cachedCartMerchantLookups(
  client: SupabaseClient,
  now: () => number = Date.now
): { features: FeatureLookup; rpcClient: MerchantRpcClient } {
  const loadFeatures = createAnonMerchantFeatureLookup(client);
  return {
    async features(merchantId) {
      const cached = featureRows.get(merchantId, now());
      if (cached) return cached;
      const features = await featureReads.run(merchantId, () =>
        loadFeatures(merchantId)
      );
      if (features) featureRows.set(merchantId, features, now());
      return features;
    },
    rpcClient: {
      async rpc(functionName, args) {
        const key = args.p_identifier;
        const cached = merchantRows.get(key, now());
        if (cached !== undefined) return { data: cached, error: null };
        const reply = await merchantReads.run(key, async () => {
          const { data, error } = await client.rpc(functionName, args);
          return { data, error };
        });
        if (cacheableMerchantReply(reply)) {
          merchantRows.set(key, reply.data, now());
        }
        return reply;
      },
    },
  };
}

export function __resetCartMerchantLookupCacheForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '__resetCartMerchantLookupCacheForTesting should only run in tests'
    );
  }
  merchantRows.clear();
  featureRows.clear();
}
