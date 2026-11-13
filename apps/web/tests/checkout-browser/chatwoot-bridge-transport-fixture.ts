import type { Page } from '@playwright/test';

const widgetOrigin = 'https://support.example.test';
const untrustedWidgetOrigin = 'https://untrusted.example.test';
const requestId = 'fixture_context_123456';
const conversationId = 905;
const visitorTokenSha256 = 'b'.repeat(64);

type CapturedRequest = {
  path: string;
  merchantSlug: string | null;
  method: string;
  origin: string;
  csrfHeader: string | null;
  csrfCookie: string | null;
  requestCookieHeader: string | null;
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
        document.documentElement.dataset.bridgeChallengeSeen = 'true';
        parent.postMessage('baci-commerce-context-ready:' + JSON.stringify({
          requestId,
          conversationId,
          contextToken: 'synthetic-context-token',
          expiresAt: Math.floor(Date.now() / 1000) + 60
        }), targetOrigin);
      }
      if (event.data.startsWith('baci-commerce-context-authorized:')) {
        document.documentElement.dataset.authorizedMessageSeen = 'true';
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
): Promise<{
  requests: CapturedRequest[];
  harnessOrigin: string;
}> {
  if (!baseURL) throw new Error('Checkout browser fixture requires baseURL');
  const harnessOrigin = new URL(baseURL).origin;
  const requests: CapturedRequest[] = [];
  const contextPath =
    /^\/api\/storefront\/chatwoot\/context\/(challenge|verify|authorize)$/;
  await page.context().addCookies([
    {
      name: 'csrf-token',
      value: 'fixture-csrf-token',
      url: harnessOrigin,
      sameSite: 'Lax',
    },
  ]);

  for (const origin of [widgetOrigin, untrustedWidgetOrigin]) {
    await page.route(`${origin}/widget`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'text/html',
        body: widgetHtml(harnessOrigin),
      });
    });
  }

  await page.route(
    (url) =>
      url.origin === harnessOrigin &&
      contextPath.test(url.pathname) &&
      url.searchParams.size === 1 &&
      url.searchParams.get('merchantSlug') === 'ogabassey',
    async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.split('/').at(-1) ?? '';
      const merchantSlug = url.searchParams.get('merchantSlug');
      const headers = await route.request().allHeaders();
      const cookieHeader = headers.cookie ?? null;
      const csrfCookie =
        cookieHeader
          ?.split(';')
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith('csrf-token='))
          ?.slice('csrf-token='.length) ?? null;
      const csrfHeader = headers['x-csrf-token'] ?? null;
      const csrfValid =
        csrfHeader === 'fixture-csrf-token' &&
        csrfCookie === 'fixture-csrf-token';
      const method = route.request().method();
      if (method !== 'POST' || !csrfValid) {
        requests.push({
          path: endpoint,
          merchantSlug,
          method,
          origin: url.origin,
          csrfHeader,
          csrfCookie,
          requestCookieHeader: cookieHeader,
          body: null,
        });
        return route.fulfill({ status: 403, json: { error: 'forbidden' } });
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push({
        path: endpoint,
        merchantSlug,
        method,
        origin: url.origin,
        csrfHeader,
        csrfCookie,
        requestCookieHeader: cookieHeader,
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
        await route.fulfill({
          json: {
            authorized: true,
            requestId,
            conversationId,
            sessionToken: 'synthetic-session-capability',
            sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        });
        return;
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
  return {
    requests,
    harnessOrigin,
  };
}

export const chatwootBridgeTransportFixture = {
  conversationId,
  installChatwootFixture,
  requestId,
  visitorTokenSha256,
};
