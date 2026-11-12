import { chatwootBridgeTransportFixture } from './chatwoot-bridge-transport-fixture';
import { expect, test } from './network';

const {
  conversationId,
  installChatwootFixture,
  requestId,
  visitorTokenSha256,
} = chatwootBridgeTransportFixture;
type CapturedRequest = Awaited<
  ReturnType<typeof installChatwootFixture>
>['requests'][number];

function assertCookieHeaderObservation(requests: CapturedRequest[]) {
  // Playwright may omit Cookie from intercepted WebKit headers. The fixture
  // validates the cookie jar separately and checks transport when exposed.
  const observedCookies = requests.map(
    (request) => request.requestCookieHeader
  );
  expect(
    observedCookies.every(
      (cookie) =>
        cookie === null ||
        cookie
          .split(';')
          .some((entry) => entry.trim() === 'csrf-token=fixture-csrf-token')
    )
  ).toBe(true);
}

test('rejects messages from an untrusted widget iframe', async ({
  page,
  baseURL,
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
  assertCookieHeaderObservation(requests);
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

  await expect(page.locator('html')).toHaveAttribute(
    'data-chatwoot-bridge-ready',
    'true'
  );
  await widget.getByRole('button', { name: 'Request cart' }).click();
  const result = widget.locator('#cart-result');
  await expect(result).toContainText('Canonical server phone');
  await expect(result).toContainText('"cartVersion":8');
  await expect(result).not.toContainText('Forged local name');
  assertCookieHeaderObservation(requests);

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
