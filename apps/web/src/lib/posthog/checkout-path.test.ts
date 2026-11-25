import { describe, expect, it } from 'vitest';
import { isCheckoutPathname } from './checkout-path';

describe('isCheckoutPathname', () => {
  it('matches root and nested /checkout routes on any host', () => {
    expect(isCheckoutPathname('/checkout', { hostname: 'ogabassey.com' })).toBe(
      true
    );
    expect(
      isCheckoutPathname('/checkout/bnpl', { hostname: 'ogabassey.com' })
    ).toBe(true);
    expect(
      isCheckoutPathname('/checkout?step=payment', {
        hostname: 'ogabassey.usebaci.com',
      })
    ).toBe(true);
  });

  it('matches /<slug>/checkout on platform path-mode hosts', () => {
    expect(
      isCheckoutPathname('/ogabassey/checkout', {
        hostname: 'usebaci.com',
        rootDomain: 'usebaci.com',
      })
    ).toBe(true);
    expect(
      isCheckoutPathname('/ogabassey/checkout/bnpl', {
        hostname: 'localhost',
        rootDomain: 'usebaci.com',
      })
    ).toBe(true);
    expect(
      isCheckoutPathname('/ogabassey/checkout', {
        hostname: 'baci-git-main.vercel.app',
        rootDomain: 'usebaci.com',
      })
    ).toBe(true);
  });

  it('does not match non-checkout or reserved-prefix routes', () => {
    expect(isCheckoutPathname('/', { hostname: 'ogabassey.com' })).toBe(false);
    expect(
      isCheckoutPathname('/products/checkout-bag', {
        hostname: 'ogabassey.com',
      })
    ).toBe(false);
    expect(
      isCheckoutPathname('/dashboard/checkout', {
        hostname: 'usebaci.com',
        rootDomain: 'usebaci.com',
      })
    ).toBe(false);
    expect(
      isCheckoutPathname('/ogabassey/checkout', {
        hostname: 'ogabassey.com',
        rootDomain: 'usebaci.com',
      })
    ).toBe(false);
  });
});
