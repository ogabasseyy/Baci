import type { CartSnapshot } from '@baci/shared/cart';
import { nativeHandoffPreviewSchema } from '@/schemas/cart-pairing';
import { cartClientCredentialHeaders } from './client-credential';
import type { CartFetch, NativeCartConfig } from './shared-cart-client';
export async function previewNativeHandoff(
  config: NativeCartConfig,
  handoffId: string,
  token: string,
  fetcher: CartFetch
): Promise<{ snapshot: CartSnapshot; expiresAt: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(handoffId))
      throw new Error('Invalid handoff');
    const response = await fetcher(
      `${config.apiOrigin}/api/storefront/cart/handoff?merchantSlug=${encodeURIComponent(config.merchantSlug)}&handoff_id=${handoffId}`,
      {
        credentials: 'omit',
        headers: {
          'x-handoff-token': token,
          ...(await cartClientCredentialHeaders()),
        },
        redirect: 'error',
        cache: 'no-store',
        signal: abort.signal,
      }
    );
    const parsed = nativeHandoffPreviewSchema.safeParse(await response.json());
    if (
      !response.ok ||
      !parsed.success ||
      parsed.data.status !== 'pending' ||
      !parsed.data.snapshot ||
      !parsed.data.expiresAt ||
      parsed.data.merchant?.id.toLowerCase() !==
        config.merchantId.toLowerCase() ||
      parsed.data.snapshot.merchantId.toLowerCase() !==
        config.merchantId.toLowerCase() ||
      Date.parse(parsed.data.expiresAt) <= Date.now()
    )
      throw new Error('Invalid handoff');
    return { snapshot: parsed.data.snapshot, expiresAt: parsed.data.expiresAt };
  } catch {
    throw new Error('Cart preview unavailable');
  } finally {
    clearTimeout(timer);
  }
}
