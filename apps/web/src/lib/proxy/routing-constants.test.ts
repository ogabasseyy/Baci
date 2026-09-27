import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LISTING_HUB_SEGMENTS,
  MAIN_APP_ROUTES,
  ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES,
} from './routing-constants';

describe('proxy routing constants', () => {
  it('keeps the remaining proxy-owned route policy constants explicit', () => {
    expect(CATEGORY_LISTING_HUB_SEGMENTS.has('compare')).toBe(true);
    expect(MAIN_APP_ROUTES).toContain('/signup');
    expect(ROOT_DOMAIN_ONLY_MAIN_APP_ROUTES).toEqual(['/checkout']);
  });
});
