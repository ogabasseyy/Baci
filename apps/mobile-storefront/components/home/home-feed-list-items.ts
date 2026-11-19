import type { Product } from '@/types/product';
import type { HomeFeedListItem } from './home-feed-list.types';

export function buildHomeFeedItems(
  products: Product[],
  hasMore: boolean,
  feedResetKey: string
): HomeFeedListItem[] {
  const items: HomeFeedListItem[] = products.map((product) => ({
    kind: 'product',
    product,
  }));
  if (products.length > 0 && hasMore) {
    items.push({
      kind: 'product-list-end',
      id: `home-feed-product-list-end-${feedResetKey}`,
    });
  }
  return items;
}
