import { isDomainIdentifier } from '@/lib/validation';
import { StorefrontRouteNotFoundContent } from '../../../storefront-route-not-found-content';

interface RenderCategoryNotFoundContentOptions {
  message?: string;
  slug: string;
  title?: string;
}

export function renderCategoryNotFoundContent({
  slug,
  title = 'Category not found',
  message = 'This category is unavailable or has moved.',
}: RenderCategoryNotFoundContentOptions) {
  return (
    <StorefrontRouteNotFoundContent
      backHref={isDomainIdentifier(slug) ? '/' : `/${slug}`}
      message={message}
      title={title}
    />
  );
}
