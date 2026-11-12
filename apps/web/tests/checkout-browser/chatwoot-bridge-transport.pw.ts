import type { Page } from '@playwright/test';
import { expect, test } from './network';

const widgetOrigin = 'https://support.example.test';
const untrustedWidgetOrigin = 'https://untrusted.example.test';
const requestId = 'fixture_context_123456';
const conversationId = 905;
const visitorTokenSha256 = 'b'.repeat(64);

type CapturedRequest = {
  path: string;
  method: string;
  origin: string;
  body: unknown;
};

function widgetHtml(targetOrigin: string) {
  return `<!doctype html>
<html><body>
  <button id="request-cart" type="button">Request cart</button>
  <output id="cart-result"></output>
  <script>
    const targetOrigin = '${targetOrigin}';
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
        visitorTokenSha256: '${visitorTokenSha256}'
      }), targetOrigin);
    });
  </script>
</body></html>`;
}

async function installChatwootFixture(
  page: Page,
  baseURL: string | undefined
): Promise<{ requests: CapturedRequest[]; harnessOrigin: string }> {
  if (!baseURL) throw new Error('Checkout browser fixture requires baseURL');
  const harnessOrigin = new URL(baseURL).origin;
  const requests: CapturedRequest[] = [];
  const contextPath =
    /^\/api\/storefront\/chatwoot\/context\/(challenge|verify|authorize)$/;

  for (const origin of [widgetOrigin, untrustedWidgetOrigin]) {
    await page.route(`${origin}/widget`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: widgetHtml(harnessOrigin),
      })
    );
  }

  await page.route(
    (url) => url.origin === harnessOrigin && contextPath.test(url.pathname),
    (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.split('/').at(-1) ?? '';
      if (route.request().method() !== 'POST') {
        requests.push({
          path: endpoint,
          method: route.request().method(),
          origin: url.origin,
          body: null,
        });
        return route.abort('blockedbyclient');
      }

      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push({
        path: endpoint,
        method: route.request().method(),
        origin: url.origin,
        body,
      });

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
  await page.waitForFunction(
    () => document.documentElement.dataset.chatwootBridgeReady === 'true'
  );
  return { requests, harnessOrigin };
}

test('rejects messages from an untrusted widget iframe', async ({
  page,
  baseURL,
}) => {
  const { requests } = await installChatwootFixture(page, baseURL);
  const attacker = page.frameLocator('#untrusted-chatwoot-widget');

  await attacker.getByRole('button', { name: 'Request cart' }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.untrustedMessageSeen === 'true'
  );

  expect(requests).toEqual([]);
  await expect(
    page.frameLocator('#chatwoot_live_chat_widget').locator('#cart-result')
  ).toHaveText('');
});

test('renders the canonical response from the trusted widget transport', async ({
  page,
  baseURL,
}) => {
  const { requests, harnessOrigin } = await installChatwootFixture(
    page,
    baseURL
  );
  const widget = page.frameLocator('#chatwoot_live_chat_widget');

  await widget.getByRole('button', { name: 'Request cart' }).click();
  const result = widget.locator('#cart-result');
  await expect(result).toContainText('Canonical server phone');
  await expect(result).toContainText('"cartVersion":8');
  await expect(result).not.toContainText('Forged local name');

  expect(
    requests.map(({ path, method, origin }) => ({ path, method, origin }))
  ).toEqual([
    { path: 'challenge', method: 'POST', origin: harnessOrigin },
    { path: 'verify', method: 'POST', origin: harnessOrigin },
    { path: 'authorize', method: 'POST', origin: harnessOrigin },
  ]);
  expect(requests[0]?.body).toEqual({
    conversationId,
    requestId,
    visitorTokenSha256,
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
  // The harness network guard denies cart writes, orders, and payments here.
});
