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
      let paymentRetryScenario = false;
      let providerErrorConsoleCount = 0;
      let provider503ConsoleCount = 0;
      let manualApiScenarioWasVisited = false;
      let manualApiIntegrationVisited = false;
      let manualApi503ConsoleCount = 0;
      let manualApi400ConsoleCount = 0;
      let manualApi403ConsoleCount = 0;
      let manualApi404ConsoleCount = 0;
      let manualCheckoutFlowVisited = false;
      let manualCheckoutProviderErrorCount = 0;
      const remainingAllowedErrors = [...allowedConsoleErrors];
      page.on('framenavigated', () => {
        const qaScenario = new URL(page.url()).searchParams.get('qa');
        if (qaScenario === 'payment-retry') paymentRetryScenario = true;
        if (
          qaScenario === 'manual-api-integration' ||
          qaScenario === 'manual-checkout-flow'
        )
          manualApiScenarioWasVisited = true;
        if (qaScenario === 'manual-api-integration')
          manualApiIntegrationVisited = true;
        if (qaScenario === 'manual-checkout-flow')
          manualCheckoutFlowVisited = true;
      });
      const manualApiScenario = () =>
        ['manual-api-integration', 'manual-checkout-flow'].includes(
          new URL(page.url()).searchParams.get('qa') ?? ''
        );
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const expectedIndex = remainingAllowedErrors.indexOf(message.text());
        if (expectedIndex >= 0) remainingAllowedErrors.splice(expectedIndex, 1);
        else if (
          manualApiIntegrationVisited &&
          manualApi400ConsoleCount < 5 &&
          /Failed to load resource:.*400/.test(message.text())
        )
          manualApi400ConsoleCount++;
        else if (
          manualApiIntegrationVisited &&
          manualApi403ConsoleCount < 5 &&
          /Failed to load resource:.*403/.test(message.text())
        )
          manualApi403ConsoleCount++;
        else if (
          manualApiIntegrationVisited &&
          manualApi404ConsoleCount === 0 &&
          /Failed to load resource:.*404/.test(message.text())
        )
          manualApi404ConsoleCount++;
        else if (
          paymentRetryScenario &&
          providerErrorConsoleCount === 0 &&
          message
            .text()
            .startsWith('Checkout error: Error: Fixture provider error')
        ) {
          providerErrorConsoleCount++;
        } else if (
          paymentRetryScenario &&
          provider503ConsoleCount === 0 &&
          /Failed to load resource:.*503/.test(message.text())
        ) {
          provider503ConsoleCount++;
        } else if (
          manualApiScenarioWasVisited &&
          manualApi503ConsoleCount === 0 &&
          /Failed to load resource:.*503/.test(message.text())
        ) {
          manualApi503ConsoleCount++;
        } else if (
          manualCheckoutFlowVisited &&
          manualCheckoutProviderErrorCount === 0 &&
          message
            .text()
            .startsWith('Checkout error: Error: Fixture provider error.')
        ) {
          manualCheckoutProviderErrorCount++;
        } else errors.push(message.text());
      });
      await context.route('**/*', (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const manualApiMethods: Record<string, string[]> = {
          '/api/cart/validate': ['POST'],
          '/api/csrf': ['GET'],
          '/api/orders': ['POST'],
          '/api/orders/reuse': ['POST'],
          '/api/payments/initialize': ['POST'],
          '/api/payments/redvault/availability': ['GET'],
          '/api/places/autocomplete': ['GET'],
          '/api/shipping/locations': ['GET'],
          '/api/shipping/quotes': ['POST'],
          '/api/storefront/auth/session': ['GET'],
          '/api/storefront/imei-remediation/orders': ['GET'],
        };
        const isManualStorefrontOrderRead =
          /^\/api\/storefront\/orders\/[^/]+$/.test(url.pathname) &&
          request.method() === 'GET';
        if (
          manualApiScenario() &&
          url.origin === new URL(page.url()).origin &&
          (manualApiMethods[url.pathname]?.includes(request.method()) ||
            isManualStorefrontOrderRead)
        )
          return route.continue();
        const responses: Record<string, unknown> = {
          '/api/cart/validate': { invalidProductIds: [], priceChanges: [] },
          '/api/csrf': { token: 'fixture-csrf-token' },
          '/api/storefront/auth/session': { authenticated: false },
          '/api/storefront/imei-remediation/orders': {
            orders: [
              {
                amountNgn: 100_000,
                amountUsdt: null,
                carrier: 'AT&T',
                completedAt: null,
                createdAt: '2026-07-11T12:00:00.000Z',
                customerMessage: 'The carrier is processing your request.',
                deviceModel: 'iPhone 17 Pro Max',
                id: 'unlock-order-fixture',
                paymentCurrency: 'NGN',
                refundPolicy: 'refundable',
                status: 'in_progress',
                successRate: 82,
                turnaround: '1-7 Days',
                updatedAt: '2026-07-11T12:03:00.000Z',
              },
            ],
          },
          '/api/payments/redvault/availability': {
            enabled: false,
            available: false,
          },
          '/api/places/autocomplete': { predictions: [] },
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
      if (manualApiIntegrationVisited) {
        expect(manualApi400ConsoleCount).toBe(5);
        expect(manualApi403ConsoleCount).toBe(5);
        expect(manualApi404ConsoleCount).toBe(1);
      }
      if (paymentRetryScenario) {
        expect(
          providerErrorConsoleCount,
          'Injected checkout provider error'
        ).toBe(1);
        expect(provider503ConsoleCount, 'Injected provider 503 response').toBe(
          1
        );
      }
      if (manualCheckoutFlowVisited)
        expect(
          manualCheckoutProviderErrorCount,
          'Manual checkout fixture provider error'
        ).toBe(1);
      expect(unexpected, 'Unexpected network calls').toEqual([]);
      expect(errors, 'Browser errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect } from '@playwright/test';
