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

it('starts a new address-review budget and shows a waiting state after the finite checks', async () => {
  vi.useFakeTimers();
  const submit = vi.fn().mockResolvedValue(true);
  const booked: OxygenRuntimeSnapshot = {
    ...snapshot,
    stage: 'booked',
    state: {
      ...snapshot.state,
      kyc: {
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
        address_status: 'PROCESSING',
      },
    },
  };
  const beforeSubmission: OxygenRuntimeSnapshot = {
    ...booked,
    state: {
      ...booked.state,
      kyc: {
        bvn_status: 'DONE' as const,
        nin_status: 'DONE' as const,
        bank_status: 'DONE' as const,
        phone_status: 'DONE' as const,
        selfie_status: 'DONE' as const,
        address_status: 'NOT_DONE' as const,
      },
    },
  };
  const hook = renderHook(
    ({
      value,
      submitted,
    }: {
      value: OxygenRuntimeSnapshot;
      submitted: boolean;
    }) => useOxygenBookingProgress(value, false, '', true, submitted, submit),
    {
      initialProps: {
        value: beforeSubmission,
        submitted: false,
      },
    }
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(submit).toHaveBeenCalledTimes(1);
  hook.rerender({ value: booked, submitted: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  for (let version = 9; version <= 13; version++) {
    hook.rerender({ value: { ...booked, version }, submitted: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
  }
  expect(hook.result.current.addressDelayed).toBe(true);
  expect(hook.result.current.manualReviewNeeded).toBe(true);
  expect(submit).toHaveBeenCalledTimes(6); // One pre-submission read, then five review reads.
  expect(
    submit.mock.calls.every(([command]) => command.action === 'refresh_kyc')
  ).toBe(true);
  await act(async () => {
    await hook.result.current.checkAddress();
  });
  expect(submit).toHaveBeenCalledTimes(7);
  expect(hook.result.current.addressDelayed).toBe(true);
  expect(hook.result.current.manualReviewNeeded).toBe(true);
  hook.rerender({
    value: { ...booked, stage: 'approval_required' },
    submitted: true,
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(submit).toHaveBeenCalledTimes(7);
});

it('checks a submitted address even when booking details have no schedule', async () => {
  vi.useFakeTimers();
  const submit = vi.fn().mockResolvedValue(true);
  renderHook(() =>
    useOxygenBookingProgress(
      {
        ...snapshot,
        stage: 'booked',
        state: {
          ...snapshot.state,
          schedule: undefined,
          booking: {
            loan_reference: snapshot.state.bookingReference ?? '',
            product_amount: 198000,
            loan_amount: 148500,
            equity_percentage: 25,
            equity_amount: 49500,
            loan_tenure: 3,
            status: 'BOOKED',
          },
        },
      },
      false,
      '',
      true,
      true,
      submit
    )
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_kyc' });
});

it('does not interpret an unavailable status request as confirmed manual review', () => {
  const submit = vi.fn();
  const { result } = renderHook(() =>
    useOxygenBookingProgress(
      { ...snapshot, stage: 'booked' },
      false,
      'Status unavailable',
      true,
      true,
      submit
    )
  );
  expect(result.current.addressStatusUnavailable).toBe(true);
  expect(result.current.manualReviewNeeded).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
