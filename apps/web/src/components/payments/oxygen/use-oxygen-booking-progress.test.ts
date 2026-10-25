import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { useOxygenBookingProgress } from './use-oxygen-booking-progress';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'payment_required',
  version: 8,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    bookingReference: '70000000-0000-4000-8000-000000000001',
    schedule: [],
  },
};
afterEach(() => vi.useRealTimers());

it('checks payment/setup confirmation automatically with a finite budget and never activates', async () => {
  vi.useFakeTimers();
  const submit = vi.fn().mockResolvedValue(true);
  const hook = renderHook(
    ({ value }) =>
      useOxygenBookingProgress(value, false, '', true, false, submit),
    { initialProps: { value: snapshot } }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  for (let cycle = 1; cycle <= 6; cycle += 1) {
    hook.rerender({ value: { ...snapshot, version: 8 + cycle } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
  }
  expect(submit.mock.calls.map(([command]) => command.action)).toEqual(
    Array(5).fill('refresh_payment_setup')
  );
  hook.rerender({
    value: {
      ...snapshot,
      stage: 'ready_for_activation',
      state: { ...snapshot.state, paymentComplete: true, setupComplete: true },
    },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(submit).toHaveBeenCalledTimes(5);
});

it.each([
  'closed',
  'busy',
  'error',
  'uncertain',
  'disabled',
] as const)('does not dispatch booking lookups while %s', async (reason) => {
  vi.useFakeTimers();
  const submit = vi.fn().mockResolvedValue(true);
  renderHook(() =>
    useOxygenBookingProgress(
      {
        ...snapshot,
        executionEnabled: reason !== 'disabled',
        pending:
          reason === 'uncertain'
            ? {
                action: 'refresh_payment_setup',
                status: 'indeterminate',
                idempotencyKey: snapshot.workflowId,
              }
            : null,
      },
      reason === 'busy',
      reason === 'error' ? 'Unconfirmed' : '',
      reason !== 'closed',
      false,
      submit
    )
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(submit).not.toHaveBeenCalled();
});

it('starts a fresh bounded status check when the customer reopens a paused application', async () => {
  vi.useFakeTimers();
  const submit = vi.fn().mockResolvedValue(true);
  const hook = renderHook(
    ({ enabled }) =>
      useOxygenBookingProgress(snapshot, false, '', enabled, false, submit),
    { initialProps: { enabled: true } }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(submit).toHaveBeenCalledTimes(1);
  hook.rerender({ enabled: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(submit).toHaveBeenCalledTimes(1);
  hook.rerender({ enabled: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(submit).toHaveBeenCalledTimes(2);
});
