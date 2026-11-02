import { describe, expect, it } from 'vitest';
import {
  KNOWN_TOP_LEVEL_ROUTES,
  MOBILE_MENU_ACCOUNT_ITEMS,
  MOBILE_MENU_SHOP_ITEMS,
  MOBILE_MENU_SUPPORT_ITEMS,
  resolveActiveMobileMenuPath,
  resolveMobileMenuBasePath,
} from './mobile-menu-routes';

describe('mobile-menu-routes', () => {
  describe('resolveMobileMenuBasePath', () => {
    it('uses propStoreSlug when provided, trimming surrounding slashes', () => {
      expect(resolveMobileMenuBasePath('ogabassey', undefined, '/products')).toBe(
        '/ogabassey'
      );
      expect(
        resolveMobileMenuBasePath('/ogabassey/', undefined, '/products')
      ).toBe('/ogabassey');
      expect(
        resolveMobileMenuBasePath('   /custom-store/  ', undefined, null)
      ).toBe('/custom-store');
    });

    it('returns empty string when candidate slug contains only slashes or whitespace', () => {
      expect(resolveMobileMenuBasePath('/', undefined, '/products')).toBe('');
      expect(resolveMobileMenuBasePath('   ', undefined, '/products')).toBe('');
    });

    it('falls back to merchantBasePath when propStoreSlug is undefined', () => {
      expect(
        resolveMobileMenuBasePath(undefined, 'merchant-slug', '/products')
      ).toBe('/merchant-slug');
      expect(
        resolveMobileMenuBasePath(undefined, '/merchant-slug/', null)
      ).toBe('/merchant-slug');
    });

    it('resolves base path from unknown pathname segment when neither prop nor merchant base path is passed', () => {
      expect(
        resolveMobileMenuBasePath(undefined, undefined, '/store-x/products')
      ).toBe('/store-x');
      expect(
        resolveMobileMenuBasePath(undefined, undefined, '/store-x')
      ).toBe('/store-x');
    });

    it('returns empty string when first segment of pathname is a known top-level route', () => {
      expect(resolveMobileMenuBasePath(undefined, undefined, '/products')).toBe(
        ''
      );
      expect(
        resolveMobileMenuBasePath(undefined, undefined, '/account/orders')
      ).toBe('');
      expect(resolveMobileMenuBasePath(undefined, undefined, '/cart')).toBe('');
      expect(resolveMobileMenuBasePath(undefined, undefined, '/')).toBe('');
      expect(resolveMobileMenuBasePath(undefined, undefined, null)).toBe('');
    });

    it('contains expected known top level routes', () => {
      expect(KNOWN_TOP_LEVEL_ROUTES.has('products')).toBe(true);
      expect(KNOWN_TOP_LEVEL_ROUTES.has('about')).toBe(true);
      expect(KNOWN_TOP_LEVEL_ROUTES.has('swap')).toBe(true);
      expect(KNOWN_TOP_LEVEL_ROUTES.has('repairs')).toBe(true);
    });
  });

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

  describe('route item configurations', () => {
    it('defines shop, account, and support collections with paths', () => {
      expect(MOBILE_MENU_SHOP_ITEMS.length).toBeGreaterThan(0);
      expect(MOBILE_MENU_ACCOUNT_ITEMS.length).toBeGreaterThan(0);
      expect(MOBILE_MENU_SUPPORT_ITEMS.length).toBeGreaterThan(0);

      expect(MOBILE_MENU_SHOP_ITEMS[0].label).toBe('Home');
      expect(MOBILE_MENU_SHOP_ITEMS[0].path).toBe('/');
    });
  });
});
