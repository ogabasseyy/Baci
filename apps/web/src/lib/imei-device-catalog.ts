import 'server-only';
import { getImeiDeviceProfile } from '@baci/shared/imei';
import type { ImeiCheckResult } from '@/app/api/storefront/imei-check/sickw-parser.types';
import {
  imeiCatalogProductsSchema,
  imeiCatalogVariantsSchema,
} from '@/schemas/imei-device-catalog';
import {
  isImeiCatalogModelMatch,
  matchImeiCatalogImage,
} from './imei-device-image-match';
import { getPublicSupabaseClient } from './public-supabase-client';

/** Optional public enrichment must never turn a paid success into a failed lookup. */
export async function enrichImeiDeviceResult(
  merchantId: string,
  result: ImeiCheckResult
): Promise<ImeiCheckResult> {
  const observed =
    result.deviceProfile ?? getImeiDeviceProfile({ device: result.device });
  const profile = {
    version: 1 as const,
    brand: observed.brand,
    model: observed.model,
    color: observed.color,
    storage: observed.storage,
    imageMatch: 'none' as const,
  };
  const fallback = { ...result, deviceProfile: profile, deviceImage: '' };
  if (!profile.model || !profile.brand) return fallback;
  const words = profile.model
    .replace(/[^a-z0-9 ]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return fallback;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ImeiCheckResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, 1500);
  });
  const enrich = async (): Promise<ImeiCheckResult> => {
    try {
      const client = getPublicSupabaseClient({ timeoutMs: 1500 });
      for (let page = 0; page < 5; page++) {
        const query = client
          .from('products')
          .select('id,name,brand,images')
          .eq('merchant_id', merchantId)
          .eq('status', 'active')
          .ilike('name', `%${words.join('%')}%`)
          .order('id')
          .abortSignal(controller.signal);
        const { data, error } = await (page === 0
          ? query.limit(21)
          : query.range(page * 21, page * 21 + 20));
        if (error || !data) return fallback;
        const products = imeiCatalogProductsSchema.safeParse(data);
        if (!products.success || !products.data.length) return fallback;
        const candidates = products.data.filter((product) =>
          isImeiCatalogModelMatch(profile, { ...product, variants: [] })
        );
        if (!candidates.length) {
          if (products.data.length < 21) return fallback;
          continue;
        }
        // Raw variant rows are private. Use the existing storefront-safe projection.
        let variants: ReturnType<typeof imeiCatalogVariantsSchema.parse> = [];
        if (profile.color) {
          const response = await client
            .rpc('get_storefront_product_variants', {
              p_product_ids: candidates.map((product) => product.id),
            })
            .select('product_id,attributes,images,primary_image')
            .abortSignal(controller.signal)
            .limit(201);
          if (response.error) return fallback;
          const parsed = imeiCatalogVariantsSchema.safeParse(response.data);
          if (!parsed.success || parsed.data.length > 200) return fallback;
          variants = parsed.data;
        }
        const match = matchImeiCatalogImage(
          profile,
          candidates.map((product) => ({
            ...product,
            variants: variants
              .filter((variant) => variant.product_id === product.id)
              .map((variant) => ({
                attributes: variant.attributes,
                images: variant.primary_image
                  ? [variant.primary_image, ...variant.images]
                  : variant.images,
              })),
          }))
        );
        if (!match) {
          if (products.data.length < 21) return fallback;
          continue;
        }
        return {
          ...result,
          deviceImage: match.imageUrl,
          deviceProfile: {
            ...profile,
            catalogProductId: match.productId,
            imageMatch: match.match,
          },
        };
      }
      return fallback;
    } catch {
      return fallback;
    }
  };
  try {
    return await Promise.race([enrich(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
