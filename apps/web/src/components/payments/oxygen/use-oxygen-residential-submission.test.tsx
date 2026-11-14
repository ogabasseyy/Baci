import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { residentialAddress } from './oxygen-residential-address';
import { useOxygenResidentialSubmission } from './use-oxygen-residential-submission';

const snapshot: OxygenRuntimeSnapshot = {
  workflowId: '690a9d2e-33b7-4106-8c68-b9019f814dce',
  stage: 'booked',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  activationEnabled: false,
  settlementEnabled: false,
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  state: {
    bookingReference: 'selected-booking',
    kyc: {
      address_status: 'NOT_DONE',
      phone_status: 'DONE',
      bvn_status: 'DONE',
      nin_status: 'DONE',
      selfie_status: 'DONE',
      bank_status: 'DONE',
    },
  },
};
const proof = {
  address: residentialAddress({ street: 'Example Road' }),
  file: new File(['bill'], 'bill.pdf', { type: 'application/pdf' }),
};
it('submits the prepared proof once after booking and never repeats a failed or indeterminate attempt', async () => {
  const submit = vi.fn().mockResolvedValue(false);
  const { result, rerender } = renderHook(
    ({ current }) =>
      useOxygenResidentialSubmission(current, true, false, '', submit),
    { initialProps: { current: snapshot } }
  );
  act(() => result.current.prepare(snapshot.workflowId, proof));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit).toHaveBeenCalledWith(
    { action: 'submit_address', ...proof.address },
    proof.file
  );
  rerender({ current: { ...snapshot, version: 2 } });
  expect(submit).toHaveBeenCalledTimes(1);
});
it('does not send a bill before booking, in another workflow, or while confirmation is pending', () => {
  const submit = vi.fn();
  const { result, rerender } = renderHook(
    ({ current }) =>
      useOxygenResidentialSubmission(current, true, false, '', submit),
    {
      initialProps: {
        current: {
          ...snapshot,
          stage: 'application_required',
        } as OxygenRuntimeSnapshot,
      },
    }
  );
  act(() => result.current.prepare(snapshot.workflowId, proof));
  expect(submit).not.toHaveBeenCalled();
  rerender({ current: { ...snapshot, workflowId: 'another-workflow' } });
  expect(submit).not.toHaveBeenCalled();
  rerender({
    current: {
      ...snapshot,
      pending: {
        action: 'book',
        status: 'indeterminate',
        idempotencyKey: 'pending',
      },
    },
  });
  expect(submit).not.toHaveBeenCalled();
});
