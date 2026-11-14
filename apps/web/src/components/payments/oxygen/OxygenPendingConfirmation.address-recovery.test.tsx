import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('./OxygenQueuedAddressRecovery', () => ({
  OxygenQueuedAddressRecovery: () => <p>Reselect address proof</p>,
}));
vi.mock('./OxygenSavedPlans', () => ({ OxygenSavedPlans: () => null }));

import { OxygenPendingConfirmation } from './OxygenPendingConfirmation';

const snapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'booked',
  version: 3,
  environment: 'staging',
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    bookingReference: '70000000-0000-4000-8000-000000000001',
    booking: { status: 'BOOKED' },
    kyc: { address_status: 'NOT_DONE' },
  },
  pending: {
    action: 'submit_address',
    status: 'queued',
    idempotencyKey: '80000000-0000-4000-8000-000000000001',
  },
};
function show(value: unknown) {
  return render(
    <OxygenPendingConfirmation
      snapshot={value as never}
      needsSignIn={false}
      busy={false}
      error=""
      refresh={vi.fn()}
      submit={vi.fn()}
      selfieConfirmed={false}
      setComparingPlans={vi.fn()}
    />
  );
}
it('offers explicit reselection only for the eligible queued booking', () => {
  show(snapshot);
  expect(screen.getByText('Reselect address proof')).toBeDefined();
});
it.each([
  'executing',
  'indeterminate',
])('does not offer reselection when %s', (status) => {
  show({ ...snapshot, pending: { ...snapshot.pending, status } });
  expect(screen.queryByText('Reselect address proof')).toBeNull();
});
it('does not offer reselection without the current booking reference', () => {
  show({
    ...snapshot,
    state: { ...snapshot.state, bookingReference: undefined },
  });
  expect(screen.queryByText('Reselect address proof')).toBeNull();
});
