import { describe, expect, it } from 'vitest';
import {
  KNOWN_TOP_LEVEL_ROUTES,
  MOBILE_MENU_ACCOUNT_ITEMS,
  MOBILE_MENU_SHOP_ITEMS,
  MOBILE_MENU_SUPPORT_ITEMS,
} from './mobile-menu-constants';

describe('mobile-menu-constants', () => {
  it('defines shop, account, and support collections with paths', () => {
    expect(MOBILE_MENU_SHOP_ITEMS.length).toBeGreaterThan(0);
    expect(MOBILE_MENU_ACCOUNT_ITEMS.length).toBeGreaterThan(0);
    expect(MOBILE_MENU_SUPPORT_ITEMS.length).toBeGreaterThan(0);

    expect(MOBILE_MENU_SHOP_ITEMS[0].label).toBe('Home');
    expect(MOBILE_MENU_SHOP_ITEMS[0].path).toBe('/');
  });

  it('contains expected known top level routes', () => {
    expect(KNOWN_TOP_LEVEL_ROUTES.has('products')).toBe(true);
    expect(KNOWN_TOP_LEVEL_ROUTES.has('about')).toBe(true);
    expect(KNOWN_TOP_LEVEL_ROUTES.has('swap')).toBe(true);
    expect(KNOWN_TOP_LEVEL_ROUTES.has('repairs')).toBe(true);
  });
});
