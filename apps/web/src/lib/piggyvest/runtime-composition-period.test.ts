import { expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { createPiggyvestRuntimeComposition } from './runtime-composition';

vi.mock('server-only', () => ({}));
it('keeps period reads opt-in and enforces authentication, goal scope and GET-only transport', async () => {
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
  const url = `${origin}/period-attribution?goalId=${fixture.identity.goalId}&ledgerOperationId=abcdef00-0000-4000-8000-000000000001`;
  const disabled = createPiggyvestRuntimeComposition(options);
  expect((await disabled(new Request(url))).status).toBe(503);
  const enabled = createPiggyvestRuntimeComposition({
    ...options,
    services: { periodRecovery: { enabled: true } },
  });
  fixture.getUser.mockRejectedValueOnce(new Error('Synthetic unauthenticated'));
  expect((await enabled(new Request(url))).status).toBe(401);
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(
    (
      await enabled(
        new Request(
          url.replace(
            fixture.identity.goalId,
            fixture.identity.goalId.replace(/1$/, '2')
          )
        )
      )
    ).status
  ).toBe(403);
  expect((await enabled(new Request(url, { method: 'POST' }))).status).toBe(
    405
  );
  expect(fixture.execute).not.toHaveBeenCalled();
});
