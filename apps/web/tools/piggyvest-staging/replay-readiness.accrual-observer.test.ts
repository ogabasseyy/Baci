import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import type { createAccrualObserverReplay } from './replay-accrual-observer-runtime';
import type { checkFinancialReplayReadiness } from './replay-financial-readiness';
import type { loadPrefundedReplay } from './replay-prefunded-loader';
import { checkReplayReadiness } from './replay-readiness';

beforeEach(() => {
  // Observer schemas pin a fixed execution deadline with a Date.now()
  // expiry refine: freeze before it so happy-path tests stay green
  // regardless of wall-clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function fixture() {
  const sample = createAccrualObserverTestFixture();
  const read = vi.fn(async () => sample.configuration);
  const load = vi
    .fn<typeof loadPrefundedReplay>()
    .mockResolvedValue({ resolveEnrollment: vi.fn(), replay: vi.fn() });
  const accrual = vi
    .fn<typeof createAccrualObserverReplay>()
    .mockResolvedValue(async () => 'applied');
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
  return { sample, read, load, accrual, financial, fetchImplementation };
}

it('requires protected scope and observer authority readiness before any receipt-facing request', async () => {
  const dependencies = fixture();
  await expect(checkReplayReadiness(dependencies)).resolves.toEqual({
    ready: true,
  });
  expect(dependencies.accrual).toHaveBeenCalledExactlyOnceWith({
    observer: dependencies.sample.observer,
    activation: dependencies.sample.configuration.prefundedReplay,
    expectedAppSystemId: dependencies.sample.configuration.appSystemId,
  });
  expect(dependencies.load.mock.invocationCallOrder[0]).toBeLessThan(
    dependencies.accrual.mock.invocationCallOrder[0]
  );
  expect(dependencies.accrual.mock.invocationCallOrder[0]).toBeLessThan(
    dependencies.fetchImplementation.mock.invocationCallOrder[0]
  );
});

it('reports observer preflight failure without touching receipt transport or returning ready', async () => {
  const dependencies = fixture();
  dependencies.accrual.mockRejectedValue(new Error('private-marker'));
  await expect(checkReplayReadiness(dependencies)).resolves.toEqual({
    ready: false,
    stage: 'accrual-observer',
  });
  expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
  expect(dependencies.financial).not.toHaveBeenCalled();
});
