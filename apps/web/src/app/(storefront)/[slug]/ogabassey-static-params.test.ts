import { describe, expect, it } from 'vitest';
import {
  getOgabasseyStaticParams,
  isOgabasseyStaticTenant,
} from './ogabassey-static-params';

describe('ogabassey static tenants', () => {
  it('recognizes only the monitored host identifiers', () => {
    expect(getOgabasseyStaticParams().map((entry) => entry.slug)).toEqual([
      'ogabassey.com',
      'ogabassey',
    ]);
    expect(isOgabasseyStaticTenant('ogabassey')).toBe(true);
    expect(isOgabasseyStaticTenant('ogabassey.com')).toBe(true);
    expect(isOgabasseyStaticTenant('other-store')).toBe(false);
  });
});
