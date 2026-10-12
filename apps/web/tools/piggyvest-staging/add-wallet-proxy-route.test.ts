import { describe, expect, it } from 'vitest';
import { addWalletProxyRoute } from './add-wallet-proxy-route';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';
import { customerFundingRoutes } from './customer-funding-routes';

const funding = customerFundingRoutes().proxyRoutes;
const baseline = {
  version: 3,
  routes: [
    ...customerDraftProxyRoutes(),
    ...funding,
    ...funding.map(({ src }) => ({ src, status: 405 })),
    { handle: 'filesystem' },
  ],
};

describe('general wallet staging proxy', () => {
  it('preserves existing routes and adds only exact GET wallet plus method rejection', () => {
    const original = JSON.stringify(baseline);
    const result = addWalletProxyRoute(baseline);
    expect(result.routes.slice(0, -3)).toEqual(baseline.routes.slice(0, -1));
    expect(result.routes.slice(-3)).toEqual([
      {
        src: '^/api/storefront/customer/wallet$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/wallet',
        methods: ['GET'],
      },
      { src: '^/api/storefront/customer/wallet$', status: 405 },
      { handle: 'filesystem' },
    ]);
    expect(JSON.stringify(baseline)).toBe(original);
  });

  it('refuses unexpected baseline routes and configuration rather than overwriting them', () => {
    for (const config of [
      null,
      {},
      { ...baseline, crons: [] },
      {
        ...baseline,
        routes: [
          { src: '/api/.*', dest: 'https://example.com' },
          ...baseline.routes,
        ],
      },
    ]) {
      expect(() => addWalletProxyRoute(config)).toThrow('baseline');
    }
  });

  it('refuses a repeat transformation', () => {
    expect(() => addWalletProxyRoute(addWalletProxyRoute(baseline))).toThrow(
      'baseline'
    );
  });
});
