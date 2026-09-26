import { test as base, expect } from '@playwright/test';
import { isFixtureAssetRequest } from './request-allowlist';

export const test = base.extend<{
  networkGuard: undefined;
  allowedConsoleErrors: string[];
}>({
  // Each entry permits at most one exact console message. This is only for
  // deliberately injected failures; unhandled page errors are never allowed.
  allowedConsoleErrors: [[], { option: true }],
  networkGuard: [
    async ({ context, page, allowedConsoleErrors }, use) => {
      const unexpected: string[] = [];
      const errors: string[] = [];
      const remainingAllowedErrors = [...allowedConsoleErrors];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const expectedIndex = remainingAllowedErrors.indexOf(message.text());
        if (expectedIndex >= 0) remainingAllowedErrors.splice(expectedIndex, 1);
        else errors.push(message.text());
      });
      await context.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const responses: Record<string, unknown> = {
          '/api/cart/validate': { invalidProductIds: [], priceChanges: [] },
          '/api/csrf': { token: 'fixture-csrf-token' },
          '/api/storefront/auth/session': { authenticated: false },
          '/api/payments/redvault/availability': {
            enabled: false,
            available: false,
          },
          '/api/shipping/locations': {
            states: ['Lagos'],
            locations: [{ city: 'Ikeja', state: 'Lagos' }],
          },
          '/api/shipping/quotes': { quotes: [] },
        };
        if (url.pathname in responses)
          return route.fulfill({ json: responses[url.pathname] });
        if (
          isFixtureAssetRequest({
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            rsc: request.headers().rsc,
          })
        )
          return route.continue();
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      });
      await use(undefined);
      expect(unexpected, 'Unexpected network calls').toEqual([]);
      expect(errors, 'Browser errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect } from '@playwright/test';
