import { describe, expect, it } from 'vitest';
import {
  MOBILE_MENU_ACCOUNT_ITEMS,
  MOBILE_MENU_SHOP_ITEMS,
  MOBILE_MENU_SUPPORT_ITEMS,
} from './mobile-menu-constants';
import { resolveActiveMobileMenuPath } from './resolve-active-mobile-menu-path';

describe('resolveActiveMobileMenuPath', () => {
  const buildHref = (path: string) =>
    path === '/' ? '/ogabassey' : `/ogabassey${path}`;

  it('matches exact root path for home item', () => {
    const activePath = resolveActiveMobileMenuPath({
      items: MOBILE_MENU_SHOP_ITEMS,
      pathname: '/ogabassey',
      buildHref,
    });
    expect(activePath).toBe('/');
  });

  it('matches root path with trailing slash', () => {
    const activePath = resolveActiveMobileMenuPath({
      items: MOBILE_MENU_SHOP_ITEMS,
      pathname: '/ogabassey/',
      buildHref,
    });
    expect(activePath).toBe('/');
  });

  it('matches specific section route', () => {
    const activePath = resolveActiveMobileMenuPath({
      items: MOBILE_MENU_SHOP_ITEMS,
      pathname: '/ogabassey/swap',
      buildHref,
    });
    expect(activePath).toBe('/swap');
  });

  it('matches nested subpath and chooses the longest matching path', () => {
    const activePath = resolveActiveMobileMenuPath({
      items: MOBILE_MENU_ACCOUNT_ITEMS,
      pathname: '/ogabassey/account/orders/123',
      buildHref,
    });
    expect(activePath).toBe('/account/orders');
  });

  it('returns undefined when no items match the pathname', () => {
    const activePath = resolveActiveMobileMenuPath({
      items: MOBILE_MENU_SUPPORT_ITEMS,
      pathname: '/ogabassey/unrelated-page',
      buildHref,
    });
    expect(activePath).toBeUndefined();
  });
});
