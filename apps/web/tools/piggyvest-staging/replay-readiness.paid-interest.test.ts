import { expect, it, vi } from 'vitest';
import type { checkFinancialReplayReadiness } from './replay-financial-readiness';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';
import type { loadPrefundedReplay } from './replay-prefunded-loader';
import { checkReplayReadiness } from './replay-readiness';

function fixture() {
  const sample = createPaidInterestTestFixture();
  const read = vi.fn(async () => sample.configuration);
  const load = vi.fn<typeof loadPrefundedReplay>().mockResolvedValue({
    resolveEnrollment: vi.fn(),
    replay: vi.fn(),
  });
  const financial = vi
    .fn<typeof checkFinancialReplayReadiness>()
    .mockResolvedValue('ready');
  const fetchImplementation = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      new Request(input).url.includes('receipts-rest')
        ? sample.configuration.receiptSystemId
        : sample.configuration.appSystemId
    )
  );
  return { sample, read, load, financial, fetchImplementation };
}

it('checks the separate paid-interest authority and supplies exact scope to pinned loading', async () => {
  const dependencies = fixture();
  await expect(checkReplayReadiness(dependencies)).resolves.toEqual({
    ready: true,
  });
  expect(dependencies.load).toHaveBeenCalledExactlyOnceWith({
    activation: dependencies.sample.configuration.prefundedReplay,
    expectedAppSystemId: dependencies.sample.configuration.appSystemId,
    paidInterestScope: {
      integrationId: dependencies.sample.scope.integrationId,
      businessId: dependencies.sample.scope.businessId,
      expectedSystemId: dependencies.sample.scope.expectedSystemId,
    },
  });
  expect(dependencies.financial).toHaveBeenCalledExactlyOnceWith(
    dependencies.sample.configuration.paidInterestDatabase,
    dependencies.sample.configuration.appSystemId
  );
  expect(dependencies.fetchImplementation).toHaveBeenCalledTimes(2);
});

it.each([
  ['authority-unavailable', 'interest-authority'],
  ['transport-unavailable', 'financial-database'],
] as const)('keeps paired %s failures explicit without replay', async (status, stage) => {
  const dependencies = fixture();
  dependencies.financial.mockResolvedValue(status);
  await expect(checkReplayReadiness(dependencies)).resolves.toEqual({
    ready: false,
    stage,
  });
  expect(dependencies.load.mock.results).toHaveLength(1);
});

it('refuses scope or hash failure without touching the interest database', async () => {
  const dependencies = fixture();
  dependencies.load.mockRejectedValue(new Error('scope mismatch'));
  await expect(checkReplayReadiness(dependencies)).resolves.toEqual({
    ready: false,
    stage: 'prefunded-runtime',
  });
  expect(dependencies.financial).not.toHaveBeenCalled();
  expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
});

it('redacts paired interest connection errors', async () => {
  const dependencies = fixture();
  dependencies.financial.mockRejectedValue(new Error('private password'));
  await expect(checkReplayReadiness(dependencies)).resolves.toEqual({
    ready: false,
    stage: 'financial-database',
  });
});
