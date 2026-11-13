import type { Page } from '@playwright/test';
import { isChatwootBridgeFixtureRequest } from './chatwoot-bridge-request-allowlist';

const requestId = 'fixture_context_123456';
const conversationId = 905;
const visitorTokenSha256 = 'b'.repeat(64);

type CapturedRequest = {
  path: string;
  merchantSlug: string | null;
  method: string;
  origin: string;
  csrfHeader: string | null;
  csrfCookieValidated: boolean | null;
  responseStatus: number | null;
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
  await page.context().addCookies([
    {
      name: 'csrf-token',
      value: 'fixture-csrf-token',
      url: harnessOrigin,
      sameSite: 'Lax',
    },
  ]);

  await page.route(
    (url) =>
      url.origin !== harnessOrigin &&
      isChatwootBridgeFixtureRequest({
        url: url.href,
        method: 'GET',
        harnessOrigin,
        fixtureVisited: true,
      }),
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        contentType: 'text/html',
        body: widgetHtml(harnessOrigin),
      });
    }
  );

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== harnessOrigin ||
      !url.pathname.includes('/api/storefront/chatwoot/context/')
    )
      return;
    const headers = request.headers();
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      // Malformed bodies are captured as null; the harness route rejects them.
    }
    requests.push({
      path: url.pathname.split('/').at(-1) ?? '',
      merchantSlug: url.searchParams.get('merchantSlug'),
      method: request.method(),
      origin: url.origin,
      csrfHeader: headers['x-csrf-token'] ?? null,
      csrfCookieValidated: null,
      responseStatus: null,
      body,
    });
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.origin !== harnessOrigin ||
      !url.pathname.includes('/api/storefront/chatwoot/context/')
    )
      return;
    const endpoint = url.pathname.split('/').at(-1) ?? '';
    const captured = requests.find(
      (request) => request.path === endpoint && request.responseStatus === null
    );
    if (!captured) return;
    captured.responseStatus = response.status();
    captured.csrfCookieValidated =
      response.headers()['x-fixture-csrf-cookie-validated'] === 'true';
  });

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
