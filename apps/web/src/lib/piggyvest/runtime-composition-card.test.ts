import { expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { createPiggyvestRuntimeComposition } from './runtime-composition';

vi.mock('server-only', () => ({}));

it('connects authenticated card intake after actual CSRF bootstrap without provider dispatch', async () => {
  const fixture = createFundingScreenFixture();
  const origin = 'http://127.0.0.1:4181';
  const idempotencyKey = '60000000-0000-4000-8000-000000000001';
  const input = {
    goalId: fixture.identity.goalId,
    savedMethodId: idempotencyKey,
    idempotencyKey,
    amountKobo: 100,
    consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
  };
  const execute = vi.fn().mockResolvedValue({
    rows: [
      {
        result: {
          operationId: idempotencyKey,
          goalId: input.goalId,
          amountKobo: 100,
          currency: 'NGN',
          status: 'pending',
        },
      },
    ],
  });
  const options = {
    origin,
    configuration: {
      mode: 'local_test',
      goalId: input.goalId,
      context: fixture.options.configuration,
      termsDocument: fixture.options.termsDocument,
    },
    createRlsClient: async () => fixture.options.supabase,
    execute: fixture.execute,
  };
  const app = createPiggyvestRuntimeComposition({
    ...options,
    services: {
      prefundedCard: { enabled: true, expectedSystemId: '123', execute },
    },
  });
  const body = JSON.stringify(input);
  expect(
    (
      await app(
        new Request(`${origin}/card-contributions`, { method: 'POST', body })
      )
    ).status
  ).toBe(403);
  expect(execute).not.toHaveBeenCalled();
  const bootstrap = await app(
    new Request(`${origin}/csrf`, { headers: { origin } })
  );
  const { csrfToken } = await bootstrap.json();
  const cookie = bootstrap.headers.getSetCookie()[0].split(';')[0];
  const response = await app(
    new Request(`${origin}/card-contributions`, {
      method: 'POST',
      body,
      headers: {
        origin,
        cookie,
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
    })
  );
  expect(response.status).toBe(202);
  expect(execute).toHaveBeenCalledOnce();
  expect(
    (
      await app(
        new Request(`${origin}/card-contributions`, { method: 'DELETE' })
      )
    ).status
  ).toBe(405);
  const disabled = createPiggyvestRuntimeComposition(options);
  expect(
    (await disabled(new Request(`${origin}/card-contributions`))).status
  ).toBe(503);
});
