import { describe, expect, it } from 'vitest';
import {
  getOgabasseyStaticParams,
  OGABASSEY_STATIC_TENANTS,
} from './ogabassey-static-params';

describe('getOgabasseyStaticParams', () => {
  it('prerenders both OgaBassey host identifiers', () => {
    expect(OGABASSEY_STATIC_TENANTS).toEqual(['ogabassey.com', 'ogabassey']);
    expect(getOgabasseyStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });
});
