import { expect, test } from './network';

const widgetOrigin = 'https://support.example.test';
const requestId = 'fixture_context_123456';
const conversationId = 905;

const widgetHtml = `<!doctype html>
<html><body>
  <button id="request-cart" type="button">Request cart</button>
  <output id="cart-result"></output>
  <script>
    const targetOrigin = new URL(document.referrer).origin;
    const requestId = '${requestId}';
    const conversationId = ${conversationId};
    const received = (event) => {
      if (event.origin !== targetOrigin || event.source !== parent) return;
      if (typeof event.data !== 'string') return;
      if (event.data.startsWith('baci-commerce-context-challenge:')) {
        parent.postMessage('baci-commerce-context-ready:' + JSON.stringify({
          requestId,
          conversationId,
          contextToken: 'synthetic-context-token',
          expiresAt: Math.floor(Date.now() / 1000) + 60
        }), targetOrigin);
      }
      if (event.data.startsWith('baci-commerce-context-authorized:')) {
        const authorization = JSON.parse(event.data.slice('baci-commerce-context-authorized:'.length));
        parent.postMessage('baci-cart-request:' + JSON.stringify({
          requestId: 'fixture_cart_123456',
          conversationId,
          sessionToken: authorization.sessionToken
        }), targetOrigin);
      }
      if (event.data.startsWith('baci-cart-view:')) {
        document.querySelector('#cart-result').textContent = event.data;
      }
    };
    window.addEventListener('message', received);
    document.querySelector('#request-cart').addEventListener('click', () => {
      parent.postMessage('baci-commerce-context-request:' + JSON.stringify({
        requestId,
        conversationId,
        websiteToken: 'synthetic-widget-token-123456',
        visitorTokenSha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      }), targetOrigin);
    });
  </script>
</body></html>`;

test('mocked browser transport accepts the trusted widget and renders its canonical response', async ({
  page,
}) => {
  const requests: Array<{ path: string; body: unknown }> = [];

  await page.route(`${widgetOrigin}/widget`, (route) =>
    route.fulfill({ contentType: 'text/html', body: widgetHtml })
  );
  await page.route(
    /\/api\/storefront\/chatwoot\/context\/(challenge|verify|authorize)(?:\?.*)?$/,
    (route) => {
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const endpoint = url.pathname.split('/').at(-1) ?? '';
      requests.push({ path: endpoint, body });

      if (endpoint === 'challenge') {
        return route.fulfill({
          json: {
            requestId: body.requestId,
            widgetOrigin,
            challengeToken: 'synthetic-challenge-token',
            expiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        });
      }
      if (endpoint === 'verify') {
        return route.fulfill({
          json: {
            authorized: true,
            requestId,
            conversationId,
            sessionToken: 'synthetic-session-capability',
            sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        });
      }
      return route.fulfill({
        json: {
          authorized: true,
          conversationId,
          sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
          cartSnapshot: {
            cartVersion: 8,
            currency: 'NGN',
            estimatedTotals: false,
            items: [
              {
                lineId: 'server-line-1',
                name: 'Canonical server phone',
                productId: 'server-product-1',
                variantId: null,
                condition: null,
                quantity: 2,
                unitPriceMinor: 125000,
                lineTotalMinor: 250000,
              },
            ],
            itemsSubtotalMinor: 250000,
          },
        },
      });
    }
  );

  await page.goto('/chatwoot-bridge');
  const widget = page.frameLocator('#chatwoot_live_chat_widget');
  await widget.getByRole('button', { name: 'Request cart' }).click();
  const result = widget.locator('#cart-result');
  await expect(result).toContainText('Canonical server phone');
  await expect(result).toContainText('"cartVersion":8');
  await expect(result).not.toContainText('Forged local name');

  expect(requests.map((request) => request.path)).toEqual([
    'challenge',
    'verify',
    'authorize',
  ]);
  expect(requests[0]?.body).toMatchObject({
    conversationId,
    requestId,
    websiteToken: 'synthetic-widget-token-123456',
  });
  expect(requests[1]?.body).toEqual({
    challengeToken: 'synthetic-challenge-token',
    contextToken: 'synthetic-context-token',
  });
  expect(requests[2]?.body).toEqual({
    sessionToken: 'synthetic-session-capability',
    includeCartSnapshot: true,
  });
  expect(requests.map((request) => request.path)).not.toContain('commands');
  expect(requests.map((request) => request.path)).not.toContain('orders');
  expect(requests.map((request) => request.path)).not.toContain('payments');
});
