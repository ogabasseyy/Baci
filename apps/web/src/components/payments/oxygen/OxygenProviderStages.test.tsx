import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

vi.mock('./OxygenGuidedVerification', () => ({
  OxygenGuidedVerification: () => null,
}));
vi.mock('./OxygenVerificationForms', () => ({
  OxygenVerificationForms: () => null,
}));
vi.mock('./OxygenPlanForm', () => ({
  OxygenPlanForm: () => <div>Plan form</div>,
}));
vi.mock('./OxygenSavedPlans', () => ({
  OxygenSavedPlans: ({
    refreshOffers,
  }: {
    refreshOffers?: () => Promise<boolean>;
  }) =>
    refreshOffers ? (
      <button type="button" onClick={() => void refreshOffers()}>
        Refresh saved offers
      </button>
    ) : (
      <div>Saved plan</div>
    ),
}));
vi.mock('./OxygenAddressProgress', () => ({
  OxygenAddressProgress: ({
    onRefreshOffers,
  }: {
    onRefreshOffers?: () => Promise<boolean>;
  }) =>
    onRefreshOffers ? (
      <button type="button" onClick={() => void onRefreshOffers()}>
        Refresh during address review
      </button>
    ) : (
      <div>Address review</div>
    ),
}));

import { OxygenProviderStages } from './OxygenProviderStages';
import { oxygenBookedSnapshot } from './oxygen-booked-snapshot.test-support';

const submit = vi.fn().mockResolvedValue(true);
const verified = {
  applicationReference: '60000000-0000-4000-8000-000000000001',
  validated: true,
  kyc: {
    phone_status: 'DONE',
    bvn_status: 'DONE',
    selfie_status: 'DONE',
    nin_status: 'NOT_DONE',
    bank_status: 'NOT_DONE',
    address_status: 'NOT_DONE',
  },
} as const;
function props(
  stage: OxygenRuntimeSnapshot['stage'],
  state: OxygenRuntimeSnapshot['state'],
  pending?: OxygenRuntimeSnapshot['pending']
): ComponentProps<typeof OxygenProviderStages> {
  return {
    snapshot: {
      ...oxygenBookedSnapshot,
      stage,
      state,
      pending,
      executionEnabled: true,
      approvalOtpReady: false,
    },
    flow: { orderId: 'order', active: false },
    view: {
      disabled: false,
      busy: false,
      error: '',
      activeLoanError: false,
      phoneError: '',
      replacingAddress: false,
      addressWaiting: true,
      comparingPlans: false,
    },
    actions: {
      submit,
      submitForm: vi.fn(),
      readSaved: vi.fn(),
      clearError: vi.fn(),
      setReplacingAddress: vi.fn(),
      setComparingPlans: vi.fn(),
    },
    approval: {
      autoOpenReference: undefined,
      approvePlan: vi.fn(),
      requestApprovalCode: vi.fn(),
    },
    bookingProgress: {
      checkAddress: vi.fn(),
      checkPending: vi.fn(),
      manualReviewNeeded: false,
      addressStatusUnavailable: false,
      addressDelayed: false,
      restartAddressReview: vi.fn(),
    },
    residentialContext: { ready: false, fromCheckout: false, address: {} },
    residential: { waiting: false, proof: undefined, prepare: vi.fn() },
  };
}
it('shows recovery without offers and the plan form after offers arrive', () => {
  const { rerender } = render(
    <OxygenProviderStages {...props('plan_required', { eligible: true })} />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Update payment options' })
  );
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
  rerender(
    <OxygenProviderStages
      {...props('plan_required', {
        eligible: true,
        offers: [{ tenure: 3, loanAmount: 189000 }],
      })}
    />
  );
  expect(screen.getByText('Plan form')).toBeVisible();
});
it('shows offer recovery when an empty offer list reaches the view', () => {
  render(
    <OxygenProviderStages
      {...props('plan_required', { eligible: true, offers: [] })}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Update payment options' })
  ).toBeVisible();
  expect(screen.queryByText('Plan form')).not.toBeInTheDocument();
});
it('offers refresh during address review, but not while pending or after payment/setup', () => {
  const booking = oxygenBookedSnapshot.state.booking;
  const { rerender } = render(
    <OxygenProviderStages {...props('booked', { ...verified, booking })} />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh during address review' })
  );
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
  for (const [state, pending] of [
    [
      { ...verified, booking },
      {
        action: 'book',
        status: 'queued',
        idempotencyKey: '80000000-0000-4000-8000-000000000001',
      },
    ],
    [{ ...verified, booking, paymentComplete: true }, undefined],
    [{ ...verified, booking, setupComplete: true }, undefined],
  ] as const) {
    rerender(<OxygenProviderStages {...props('booked', state, pending)} />);
    expect(
      screen.queryByRole('button', { name: 'Refresh during address review' })
    ).not.toBeInTheDocument();
  }
});
it('refreshes missing offers at approval and suppresses the action for an active command', () => {
  const state = { ...verified, booking: oxygenBookedSnapshot.state.booking };
  const { rerender } = render(
    <OxygenProviderStages {...props('approval_required', state)} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved offers' }));
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
  rerender(
    <OxygenProviderStages
      {...props('approval_required', state, {
        action: 'approve_booking',
        status: 'queued',
        idempotencyKey: '80000000-0000-4000-8000-000000000001',
      })}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Refresh saved offers' })
  ).not.toBeInTheDocument();
});
