import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { getRequestSubdomain, runSubdomainRouting } from './subdomain-routing';

describe('subdomain routing', () => {
  it('extracts local and platform merchant labels without accepting nested labels', () => {
    expect(getRequestSubdomain('shop.localhost')).toBe('shop');
    expect(getRequestSubdomain('shop.usebaci.com')).toBe('shop');
    expect(getRequestSubdomain('deep.shop.usebaci.com')).toBeNull();
  });

  it('does not claim requests without a subdomain', async () => {
    await expect(
      runSubdomainRouting(
        new NextRequest('https://usebaci.com/products'),
        '/products',
        'usebaci.com',
        'Mozilla',
        null
      )
    ).resolves.toBeNull();
  });
});
