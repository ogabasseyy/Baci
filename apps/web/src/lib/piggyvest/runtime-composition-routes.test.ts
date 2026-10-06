import { expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { createPiggyvestRuntimeComposition } from './runtime-composition';

vi.mock('server-only', () => ({}));

it('routes actual optional handlers, fails closed when disabled and returns strict screen data', async () => {
  const fixture = createFundingScreenFixture();
  const origin = 'http://127.0.0.1:4181';
  const options = {
    origin,
    configuration: {
      mode: 'local_test',
      goalId: fixture.identity.goalId,
      context: fixture.options.configuration,
      termsDocument: fixture.options.termsDocument,
    },
    createRlsClient: async () => fixture.options.supabase,
    execute: fixture.execute,
  };
  const absent = createPiggyvestRuntimeComposition(options);
  for (const [path, method] of [
    ['/funding', 'GET'],
    ['/purchase/quote', 'POST'],
    ['/purchase/prepare', 'POST'],
    ['/purchase/status', 'GET'],
    ['/lifecycle/terms', 'POST'],
    ['/lifecycle/activate', 'POST'],
    ['/schedule', 'GET'],
    ['/close-plan', 'POST'],
    ['/device-change/quote', 'POST'],
    ['/device-change/confirm', 'POST'],
    ['/device-change/status', 'GET'],
    ['/protected-offer/publish', 'POST'],
    ['/protected-offer/status', 'GET'],
    ['/reconciliation', 'GET'],
    ['/period-attribution', 'GET'],
  ]) {
    expect(
      (await absent(new Request(`${origin}${path}`, { method }))).status
    ).toBe(503);
  }
  const screen = await absent(
    new Request(`${origin}/screen?goalId=${fixture.identity.goalId}`)
  );
  expect(await screen.json()).toMatchObject({
    status: 'ready',
    policy: { consent: 'accepted' },
    funding: { status: 'unavailable' },
  });
  const app = createPiggyvestRuntimeComposition({
    ...options,
    services: {
      purchase: { enabled: true },
      lifecycle: { enabled: true },
      schedule: { enabled: true },
      closure: { enabled: true },
      protectedOffer: { enabled: true },
      deviceChange: {
        enabled: true,
        termsDocument: fixture.options.termsDocument,
      },
    },
  });
  const bootstrap = await app(
    new Request(`${origin}/csrf`, { headers: { origin } })
  );
  const { csrfToken } = await bootstrap.json();
  const cookie = bootstrap.headers.getSetCookie()[0].split(';')[0];
  for (const path of [
    '/purchase/quote',
    '/purchase/prepare',
    '/lifecycle/terms',
    '/lifecycle/activate',
    '/schedule',
    '/close-plan',
    '/device-change/quote',
    '/device-change/confirm',
    '/protected-offer/publish',
  ]) {
    const response = await app(
      new Request(`${origin}${path}`, {
        method: 'POST',
        headers: {
          origin,
          cookie,
          'x-csrf-token': csrfToken,
          'content-type': 'application/json',
        },
        body: '{"actorId":"private"}',
      })
    );
    expect(response.status).toBe(400);
  }
  expect(
    (
      await app(
        new Request(
          `${origin}/purchase/status?goalId=${fixture.identity.goalId}`
        )
      )
    ).status
  ).toBe(400);
});
