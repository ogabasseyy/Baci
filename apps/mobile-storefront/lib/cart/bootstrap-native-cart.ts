import { nativeCartReplySchema } from '@/schemas/cart';
import { cartClientCredentialHeaders } from './client-credential';
import { NativeCartError } from './native-cart-error';
import type { CartSessionStorage } from './session-storage';
import type {
  CartFetch,
  NativeCartConfig,
  NativeCartReply,
} from './shared-cart-client';
export async function bootstrapNativeCart(
  config: NativeCartConfig,
  storage: CartSessionStorage,
  fetcher: CartFetch,
  assertCurrent: () => void,
  persist: (reply: NativeCartReply) => Promise<void>
): Promise<NativeCartReply> {
  assertCurrent();
  const existing = await storage.get(config.merchantId);
  assertCurrent();
  if (existing) return { proof: existing };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetcher(`${config.apiOrigin}/api/csrf`, {
      signal: abort.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    const raw: unknown = await response.json();
    if (
      !response.ok ||
      typeof raw !== 'object' ||
      !raw ||
      !('token' in raw) ||
      typeof raw.token !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(raw.token)
    )
      throw new NativeCartError('temporarily_unavailable');
    const created = await fetcher(
      `${config.apiOrigin}/api/storefront/cart/bootstrap?merchantSlug=${encodeURIComponent(config.merchantSlug)}`,
      {
        signal: abort.signal,
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': raw.token,
          Cookie: `__Host-csrf-token=${raw.token}`,
          ...(await cartClientCredentialHeaders()),
        },
        body: JSON.stringify({ merchantSlug: config.merchantSlug }),
      }
    );
    const parsed = nativeCartReplySchema.safeParse(await created.json());
    assertCurrent();
    // Quota exhaustion is the one bootstrap failure the shopper can act
    // on; keep its code so the status panel can ask them to wait instead
    // of showing a generic interruption. Other failures stay closed.
    if (
      created.status === 429 &&
      parsed.success &&
      parsed.data.code === 'quota_exceeded'
    )
      throw new NativeCartError('quota_exceeded');
    if (
      !created.ok ||
      !parsed.success ||
      !parsed.data.proof ||
      parsed.data.merchant?.id.toLowerCase() !== config.merchantId
    )
      throw new NativeCartError('temporarily_unavailable');
    const reply = { proof: parsed.data.proof };
    await persist(reply);
    return reply;
  } catch (error) {
    if (error instanceof NativeCartError) throw error;
    throw new NativeCartError('temporarily_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
