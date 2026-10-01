import { getStorefrontScopedHref } from '@/components/builder/storefront-scoping';

export function getStorefrontNavigationHref(
  path: string,
  basePath?: string
): string {
  return getStorefrontScopedHref(path, basePath);
}
