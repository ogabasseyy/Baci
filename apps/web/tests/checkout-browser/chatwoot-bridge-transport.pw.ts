import type { Page } from '@playwright/test';
import { expect, test } from './network';
import { isChatwootTargetOriginBlockedMessage } from './request-allowlist';

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
  baseURL: string | undefined,
  options: { holdVerify?: boolean } = {}
): Promise<{
  requests: CapturedRequest[];
  harnessOrigin: string;
  verifyRequested: Promise<void>;
  verifyResponseSent: Promise<void>;
  releaseVerifyResponse: () => void;
}> {
  if (!baseURL) throw new Error('Checkout browser fixture requires baseURL');
  const harnessOrigin = new URL(baseURL).origin;
  const requests: CapturedRequest[] = [];
  let markVerifyRequested!: () => void;
  let markVerifyResponseSent!: () => void;
  let releaseVerifyResponse!: () => void;
  const verifyRequested = new Promise<void>((resolve) => {
    markVerifyRequested = resolve;
  });
  const verifyResponseSent = new Promise<void>((resolve) => {
    markVerifyResponseSent = resolve;
  });
  const verifyResponseGate = new Promise<void>((resolve) => {
    releaseVerifyResponse = resolve;
  });
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
    await page.route(`${origin}/widget`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: widgetHtml(harnessOrigin),
      })
    );
  }

  await page.route(
    (url) => url.origin === harnessOrigin && contextPath.test(url.pathname),
    async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.split('/').at(-1) ?? '';
      const merchantSlug = url.searchParams.get('merchantSlug');
      const headers = route.request().headers();
      const cookieHeader = await route.request().headerValue('cookie');
      // Some Playwright engines omit Cookie from intercepted headers. The
      // context-cookie check is fixture state; requestCookieHeader records
      // actual transport evidence when the engine exposes it.
      const csrfCookie =
        (await page.context().cookies(harnessOrigin)).find(
          (cookie) => cookie.name === 'csrf-token'
        )?.value ?? null;
      const requestCsrfCookie =
        cookieHeader
          ?.split(';')
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith('csrf-token='))
          ?.slice('csrf-token='.length) ?? null;
      const csrfHeader = headers['x-csrf-token'] ?? null;
      const csrfValid =
        csrfHeader === 'fixture-csrf-token' &&
        csrfCookie === 'fixture-csrf-token' &&
        (cookieHeader === null || requestCsrfCookie === 'fixture-csrf-token');
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
        markVerifyRequested();
        if (options.holdVerify) await verifyResponseGate;
        await route.fulfill({
          json: {
            authorized: true,
            requestId,
            conversationId,
            sessionToken: 'synthetic-session-capability',
            sessionExpiresAt: Math.floor(Date.now() / 1000) + 60,
          },
        });
        markVerifyResponseSent();
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

  await page.goto(
    options.holdVerify
      ? '/chatwoot-bridge?target-origin-race=1'
      : '/chatwoot-bridge'
  );
  return {
    requests,
    harnessOrigin,
    verifyRequested,
    verifyResponseSent,
    releaseVerifyResponse,
  };
}

function assertCookieHeaderObservation(
  requests: CapturedRequest[],
  browserName: string
) {
  const observedCookies = requests.map(
    (request) => request.requestCookieHeader
  );
  if (browserName === 'webkit') {
    expect(observedCookies).toEqual(requests.map(() => null));
    return;
  }
  expect(
    observedCookies.every((cookie) =>
      cookie
        ?.split(';')
        .some((entry) => entry.trim() === 'csrf-token=fixture-csrf-token')
    )
  ).toBe(true);
}

test('rejects messages from an untrusted widget iframe', async ({
  page,
  baseURL,
  browserName,
}) => {
  const { requests } = await installChatwootFixture(page, baseURL);
  const attacker = page.frameLocator('#untrusted-chatwoot-widget');

  await expect(page.locator('html')).toHaveAttribute(
    'data-chatwoot-bridge-ready',
    'true'
  );
  await attacker.getByRole('button', { name: 'Request cart' }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.untrustedMessageSeen === 'true'
  );

  const trusted = page.frameLocator('#chatwoot_live_chat_widget');
  await trusted.getByRole('button', { name: 'Request cart' }).click();
  await expect(trusted.locator('#cart-result')).toContainText(
    'Canonical server phone'
  );
  expect(
    requests.map(({ path, merchantSlug, method }) => ({
      path,
      merchantSlug,
      method,
    }))
  ).toEqual([
    { path: 'challenge', merchantSlug: 'ogabassey', method: 'POST' },
    { path: 'verify', merchantSlug: 'ogabassey', method: 'POST' },
    { path: 'authorize', merchantSlug: 'ogabassey', method: 'POST' },
  ]);
  await expect(attacker.locator('#cart-result')).toHaveText('');
  assertCookieHeaderObservation(requests, browserName);
});

test('renders the canonical response from the trusted widget transport', async ({
  page,
  baseURL,
  browserName,
}) => {
  const { requests, harnessOrigin } = await installChatwootFixture(
    page,
    baseURL
  );
  const widget = page.frameLocator('#chatwoot_live_chat_widget');

  await expect(page.locator('html')).toHaveAttribute(
    'data-chatwoot-bridge-ready',
    'true'
  );
  await widget.getByRole('button', { name: 'Request cart' }).click();
  const result = widget.locator('#cart-result');
  await expect(result).toContainText('Canonical server phone');
  await expect(result).toContainText('"cartVersion":8');
  await expect(result).not.toContainText('Forged local name');
  assertCookieHeaderObservation(requests, browserName);

  expect(
    requests.map(
      ({ path, merchantSlug, method, origin, csrfHeader, csrfCookie }) => ({
        path,
        merchantSlug,
        method,
        origin,
        csrfHeader,
        csrfCookie,
      })
    )
  ).toEqual([
    {
      path: 'challenge',
      merchantSlug: 'ogabassey',
      method: 'POST',
      origin: harnessOrigin,
      csrfHeader: 'fixture-csrf-token',
      csrfCookie: 'fixture-csrf-token',
    },
    {
      path: 'verify',
      merchantSlug: 'ogabassey',
      method: 'POST',
      origin: harnessOrigin,
      csrfHeader: 'fixture-csrf-token',
      csrfCookie: 'fixture-csrf-token',
    },
    {
      path: 'authorize',
      merchantSlug: 'ogabassey',
      method: 'POST',
      origin: harnessOrigin,
      csrfHeader: 'fixture-csrf-token',
      csrfCookie: 'fixture-csrf-token',
    },
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

test('does not disclose authorization to a replacement widget origin', async ({
  page,
  baseURL,
}) => {
  const blockedMessages: string[] = [];
  page.on('console', (message) => {
    if (isChatwootTargetOriginBlockedMessage(message.text()))
      blockedMessages.push(message.text());
  });
  const { verifyRequested, verifyResponseSent, releaseVerifyResponse } =
    await installChatwootFixture(page, baseURL, { holdVerify: true });
  const trusted = page.frameLocator('#chatwoot_live_chat_widget');

  await expect(page.locator('html')).toHaveAttribute(
    'data-chatwoot-bridge-ready',
    'true'
  );
  await trusted.getByRole('button', { name: 'Request cart' }).click();
  await verifyRequested;

  await page
    .locator('#chatwoot_live_chat_widget')
    .evaluate((frame: HTMLIFrameElement) => {
      // The iframe's WindowProxy remains stable as its document navigates.
      frame.src = 'https://untrusted.example.test/widget';
    });
  const replacement = page.frameLocator('#chatwoot_live_chat_widget');
  await replacement.getByRole('button', { name: 'Request cart' }).waitFor();
  await expect(page.locator('#chatwoot_live_chat_widget')).toHaveAttribute(
    'src',
    `${untrustedWidgetOrigin}/widget`
  );

  releaseVerifyResponse();
  await verifyResponseSent;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

  await expect(replacement.locator('html')).not.toHaveAttribute(
    'data-authorized-message-seen',
    'true'
  );
  expect(blockedMessages).toHaveLength(1);
});
