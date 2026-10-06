import { describe, expect, it } from 'vitest';
import { customerFundingRoutes } from './customer-funding-routes';

describe('separate staging funding routes', () => {
  it('pins exact paths, methods and staging-only destinations', () => {
    const { proxyRoutes } = customerFundingRoutes();
    expect(proxyRoutes).toEqual([
      {
        src: '^/api/storefront/customer/savings/goals$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/goals',
        methods: ['GET', 'POST'],
      },
      {
        src: '^/api/storefront/customer/savings/funding$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/funding',
        methods: ['POST'],
      },
      {
        src: '^/api/storefront/customer/wallet/piggyvest-plan$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/wallet/piggyvest-plan',
        methods: ['GET'],
      },
    ]);
    for (const path of [
      '/api/webhooks/piggyvest',
      '/api/storefront/customer/savings/cancel',
      '/api/storefront/customer/savings/funding/extra',
      '/api/storefront/customer/wallet/piggyvest-plan/extra',
      '/rest/v1/rpc/create_customer_savings_goal',
    ]) {
      expect(proxyRoutes.some(({ src }) => new RegExp(src).test(path))).toBe(
        false
      );
    }
  });

  it('isolates funding from the credential-free draft service', () => {
    const { nginxLocations } = customerFundingRoutes();
    const [goals, funding, wallet] = nginxLocations.split('\n\n');
    expect(goals).toContain('proxy_pass http://127.0.0.1:4795;');
    expect(funding).toContain('proxy_pass http://127.0.0.1:4795;');
    expect(wallet).toContain('proxy_pass http://127.0.0.1:4795;');
    expect(funding).toContain('^(' + 'POST' + ')$');
    expect(goals).toContain('^(' + 'GET|POST' + ')$');
    expect(wallet).toContain('^(' + 'GET' + ')$');
    expect(nginxLocations).not.toContain('4792');
    expect(nginxLocations.match(/access_log off;/g)).toHaveLength(3);
    expect(
      nginxLocations.match(/Cache-Control "no-store" always/g)
    ).toHaveLength(3);
    expect(nginxLocations).not.toContain('$http_host');
    expect(nginxLocations).not.toContain('location /');
  });
});
