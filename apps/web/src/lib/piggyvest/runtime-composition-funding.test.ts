import { expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { createPiggyvestRuntimeComposition } from './runtime-composition';

vi.mock('server-only', () => ({}));

it.each([
  'capability authentication',
  'mapping',
] as const)('dispatches no new funding effects after aborted %s resolves', async (phase) => {
  const fixture = createFundingScreenFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  if (phase === 'mapping') {
    const result = await fixture.mappingExecute();
    fixture.mappingExecute.mockClear();
    fixture.mappingExecute.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return result;
    });
  } else {
    const auth = await fixture.getUser();
    fixture.getUser.mockClear();
    let calls = 0;
    fixture.getUser.mockImplementation(async () => {
      if (++calls === 6) {
        entered.resolve();
        await release.promise;
      }
      return auth;
    });
  }
  const app = createPiggyvestRuntimeComposition({
    origin: 'http://127.0.0.1:4181',
    configuration: {
      mode: 'local_test',
      goalId: fixture.identity.goalId,
      context: fixture.options.configuration,
      termsDocument: fixture.options.termsDocument,
    },
    createRlsClient: async () => fixture.options.supabase,
    execute: fixture.execute,
    services: {
      funding: {
        fundingConfiguration: fixture.options.fundingConfiguration,
        fundingExecute: fixture.fundingExecute,
        mappingExecute: fixture.mappingExecute,
        fetchImplementation: fixture.fetchImplementation,
      },
    },
  });
  const controller = new AbortController();
  const pending = app(
    new Request(
      `http://127.0.0.1:4181/screen?goalId=${fixture.identity.goalId}`,
      { signal: controller.signal }
    )
  );
  await entered.promise;
  controller.abort();
  release.resolve();
  await pending;
  if (phase === 'capability authentication')
    expect(fixture.fundingExecute).not.toHaveBeenCalled();
  expect(fixture.fetchImplementation).not.toHaveBeenCalled();
});
