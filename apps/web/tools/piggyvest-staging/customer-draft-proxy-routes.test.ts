import { describe, expect, it } from 'vitest';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';

describe('isolated customer draft proxy routes', () => {
  it('routes only exact draft endpoints without matching the receiver', () => {
    const routes = customerDraftProxyRoutes();
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect(new RegExp(route.src).test('/api/webhooks/piggyvest')).toBe(false);
      expect(route.dest).toBe(
        `https://staging-auth.ogabassey.com${route.src.slice(1, -1)}`
      );
      expect(
        new RegExp(route.src).test(`${route.src.slice(1, -1)}/extra`)
      ).toBe(false);
    }
    expect(routes[0].methods).toEqual(['GET', 'POST']);
    expect(routes[1].methods).toEqual(['GET', 'POST']);
    expect(routes[2].methods).toEqual(['GET']);
  });

  it('does not route funding, cancellation, arbitrary RPCs or production', () => {
    for (const path of [
      '/api/storefront/customer/wallet/piggyvest-plan',
      '/api/storefront/customer/savings/cancel',
      '/rest/v1/rpc/customer_savings_draft_command',
      '/api/storefront/customer/savings/drafts-extra',
    ]) {
      expect(
        customerDraftProxyRoutes().some((route) =>
          new RegExp(route.src).test(path)
        )
      ).toBe(false);
    }
    expect(JSON.stringify(customerDraftProxyRoutes())).not.toContain(
      'https://ogabassey.com'
    );
  });
});
