import type { MobileMenuItem } from './mobile-menu-constants';

export function resolveActiveMobileMenuPath({
  items,
  pathname,
  buildHref,
}: {
  items: MobileMenuItem[];
  pathname: string | null;
  buildHref: (path: string) => string;
}): string | undefined {
  const matchesPath = (path: string) => {
    const fullPath = buildHref(path);
    if (path === '/') {
      return pathname === fullPath || pathname === `${fullPath}/`;
    }
    return (
      pathname === fullPath || Boolean(pathname?.startsWith(`${fullPath}/`))
    );
  };

  return items
    .map((item) => item.path)
    .filter(matchesPath)
    .sort((a, b) => b.length - a.length)[0];
}
