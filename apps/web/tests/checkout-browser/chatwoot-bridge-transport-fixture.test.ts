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
  const page = {
    context: () => ({ addCookies }),
    goto: vi.fn(async () => null),
    on: vi.fn(),
    route: vi.fn((matcher: unknown, handler: unknown) => {
      registrations.push({
        matcher,
        handler: handler as (route: Route) => Promise<unknown> | unknown,
      });
    }),
  } as unknown as Page;
  return { addCookies, page, registrations };
}

it('registers exact widget routes and seeds the harness CSRF cookie', async () => {
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
  expect(registrations).toHaveLength(1);

  const registration = registrations[0];
  if (!registration) throw new Error('Expected the widget route matcher');
  const { matcher } = registration;
  const matchesWidgetRoute = matcher as (url: URL) => boolean;
  expect(
    matchesWidgetRoute(new URL('https://support.example.test/widget'))
  ).toBe(true);
  expect(
    matchesWidgetRoute(new URL('https://untrusted.example.test/widget'))
  ).toBe(true);
  expect(
    matchesWidgetRoute(new URL('https://support.example.test/widget?extra=1'))
  ).toBe(false);
  expect(matchesWidgetRoute(new URL(`${harnessOrigin}/chatwoot-bridge`))).toBe(
    false
  );
});

it('lets non-GET widget requests fall through to the network guard', async () => {
  const { page, registrations } = installPageStub();
  await chatwootBridgeTransportFixture.installChatwootFixture(
    page,
    harnessOrigin
  );
  const widgetRoute = registrations[0];
  if (!widgetRoute) throw new Error('Expected the widget route');
  const fallback = vi.fn(async () => undefined);
  const route = {
    fallback,
    request: () => ({ method: () => 'POST' }),
  } as unknown as Route;

  await widgetRoute.handler(route);

  expect(fallback).toHaveBeenCalledOnce();
});
