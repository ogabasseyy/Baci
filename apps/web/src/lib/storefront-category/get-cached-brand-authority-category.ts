import { cacheLife, cacheTag } from 'next/cache';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';

export async function getCachedBrandAuthorityCategory(
  merchantId: string,
  categorySlug: string,
  timeoutMs = 3_000
) {
  'use cache';

  try {
    cacheLife('storefront-page');
    cacheTag('categories', `categories-${merchantId}`);
  } catch {
    // Unit tests run without Cache Components enabled.
  }

  const deadline = createStorefrontReadDeadline(timeoutMs);
  try {
    return await Promise.race([
      brandAuthorityPublicData.readCategory(
        merchantId,
        categorySlug,
        deadline.signal
      ),
      deadline.promise,
    ]);
  } finally {
    deadline.cleanup();
  }
}
