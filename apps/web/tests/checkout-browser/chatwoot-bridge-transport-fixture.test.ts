import type { Page, Route } from '@playwright/test';
import { expect, it, vi } from 'vitest';
import { chatwootBridgeTransportFixture } from './chatwoot-bridge-transport-fixture';

const harnessOrigin = 'http://127.0.0.1:3217';

function installPageStub() {
  const registrations: Array<{
    matcher: unknown;
    handler: (route: Route) => Promise<unknown> | unknown;
  }> = [];
  const addCookies = vi.fn(async () => undefined);
  const cookies = vi.fn(async () => [
    { name: 'csrf-token', value: 'fixture-csrf-token' },
  ]);
  const page = {
    context: () => ({ addCookies, cookies }),
    goto: vi.fn(async () => null),
    route: vi.fn((matcher: unknown, handler: unknown) => {
      registrations.push({
        matcher,
        handler: handler as (route: Route) => Promise<unknown> | unknown,
      });
    }),
  } as unknown as Page;
  return { addCookies, cookies, page, registrations };
}

function contextRoute(
  options: {
    headers?: Record<string, string>;
    cookieHeader?: string | null;
    body?: Record<string, unknown>;
  } = {}
) {
  const request = {
    headerValue: vi.fn(async () => options.cookieHeader ?? null),
    headers: () => options.headers ?? {},
    method: () => 'POST',
    postDataJSON: () => options.body ?? {},
    url: () =>
      `${harnessOrigin}/api/storefront/chatwoot/context/challenge?merchantSlug=ogabassey`,
  };
  const fulfill = vi.fn(async () => undefined);
  const route = {
    fulfill,
    request: () => request,
  } as unknown as Route;
  return { fulfill, route };
}

function getContextHandler(
  registrations: ReturnType<typeof installPageStub>['registrations']
) {
  const registration = registrations.find(
    ({ matcher }) => typeof matcher === 'function'
  );
  if (!registration) throw new Error('Expected the context endpoint route');
  return registration;
}

it('registers the isolated harness page and origin-scoped context endpoints', async () => {
  const { addCookies, page, registrations } = installPageStub();
  await chatwootBridgeTransportFixture.installChatwootFixture(
    page,
    harnessOrigin
  );

  expect(addCookies).toHaveBeenCalledWith([
    {
      name: 'csrf-token',
      value: 'fixture-csrf-token',
      url: harnessOrigin,
      sameSite: 'Lax',
    },
  ]);
  expect(page.goto).toHaveBeenCalledWith('/chatwoot-bridge');

  const { matcher } = getContextHandler(registrations);
  const matchesContextRoute = matcher as (url: URL) => boolean;
  expect(
    matchesContextRoute(
      new URL(`${harnessOrigin}/api/storefront/chatwoot/context/challenge`)
    )
  ).toBe(true);
  expect(
    matchesContextRoute(
      new URL(
        'https://untrusted.example.test/api/storefront/chatwoot/context/challenge'
      )
    )
  ).toBe(false);
});

it('rejects a context request without the synthetic CSRF header', async () => {
  const { page, registrations } = installPageStub();
  await chatwootBridgeTransportFixture.installChatwootFixture(
    page,
    harnessOrigin
  );
  const { handler } = getContextHandler(registrations);
  const { fulfill, route } = contextRoute();

  await handler(route);

  expect(fulfill).toHaveBeenCalledWith({
    status: 403,
    json: { error: 'forbidden' },
  });
});

it('returns a synthetic challenge when the CSRF header and jar cookie match', async () => {
  const { cookies, page, registrations } = installPageStub();
  await chatwootBridgeTransportFixture.installChatwootFixture(
    page,
    harnessOrigin
  );
  const { handler } = getContextHandler(registrations);
  const { fulfill, route } = contextRoute({
    headers: { 'x-csrf-token': 'fixture-csrf-token' },
    body: {
      conversationId: chatwootBridgeTransportFixture.conversationId,
      requestId: chatwootBridgeTransportFixture.requestId,
    },
  });

  await handler(route);

  expect(cookies).toHaveBeenCalledWith(harnessOrigin);
  expect(fulfill).toHaveBeenCalledWith({
    json: {
      requestId: chatwootBridgeTransportFixture.requestId,
      widgetOrigin: 'https://support.example.test',
      challengeToken: 'synthetic-challenge-token',
      expiresAt: expect.any(Number),
    },
  });
});
