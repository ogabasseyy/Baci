import { expect, it, vi } from 'vitest';
import { hydrateRelatedBlogProductAvailability } from './hydrate-related-blog-product-availability';

it('does not perform an unscoped offer read without merchant context', async () => {
  const rpc = vi.fn();
  const result = await hydrateRelatedBlogProductAvailability({ rpc } as never, [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Phone',
      slug: 'phone',
      category_slug: 'phone',
      has_condition_offers: true,
      stock: 0,
      manage_stock: true,
    },
  ]);
  expect(rpc).not.toHaveBeenCalled();
  expect(result[0].has_purchasable_condition_offer).toBeUndefined();
});
