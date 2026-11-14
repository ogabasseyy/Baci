import { KNOWN_TOP_LEVEL_ROUTES } from './mobile-menu-constants';

export function resolveMobileMenuBasePath(
  propStoreSlug: string | undefined,
  merchantBasePath: string | undefined,
  pathname: string | null
): string {
  const candidate = propStoreSlug ?? merchantBasePath;
  if (candidate !== undefined) {
    const trimmed = candidate.trim().replace(/^\/+|\/+$/g, '');
    return trimmed ? `/${trimmed}` : '';
  }

  const firstSegment = pathname?.split('/').filter(Boolean)[0] || '';
  if (!firstSegment || KNOWN_TOP_LEVEL_ROUTES.has(firstSegment)) {
    return '';
  }

  return `/${firstSegment}`;
}
