import 'server-only';

import type { ChatAutoReplyProduct } from '@/ai/chat-auto-reply';
import { readStorefrontPdpCoreSnapshot } from '@/lib/storefront-pdp-core-snapshot';
import { createPublicClient } from '@/lib/supabase/public';
import { projectChatwootProductCard } from './product-card-projection';

const PUBLIC_READ_BUDGET_MS = 3_000;
const MAX_SNAPSHOT_BYTES = 24_000;

/** Only the same public fields exposed by the existing product picker. */
export async function prepareChatwootProductCards(
  merchantId: string,
  cards: readonly ChatAutoReplyProduct[]
): Promise<ChatAutoReplyProduct[]> {
  try {
    const client = createPublicClient({
      clientInfo: 'baci-chatwoot-product-card',
      signal: AbortSignal.timeout(PUBLIC_READ_BUDGET_MS),
    });

    return await Promise.all(
      cards.map(async (card) => {
        if (card.storefrontOnly || !card.currency) return card;
        try {
          const snapshot = await readStorefrontPdpCoreSnapshot(client, {
            merchantId,
            productSlug: card.slug,
          });
          if (snapshot.status !== 'found' || snapshot.value.kind !== 'product')
            return card;
          const projected = projectChatwootProductCard({
            merchantId,
            currency: card.currency,
            product: snapshot.value.product,
            requestedSlug: card.slug,
          });
          if (!projected.ok) return card;

          const product = projected.product;
          return {
            ...card,
            ...(product.image ? { imageUrl: product.image } : {}),
            ...(Buffer.byteLength(JSON.stringify(product)) <= MAX_SNAPSHOT_BYTES
              ? { initialProduct: product }
              : {}),
          };
        } catch {
          return card;
        }
      })
    );
  } catch {
    return [...cards];
  }
}
