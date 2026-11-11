import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';

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

const submit = vi.fn().mockResolvedValue(true);
function props(
  stage: string,
  state: Record<string, unknown>,
  pending?: unknown
): ComponentProps<typeof OxygenProviderStages> {
  return {
    snapshot: {
      workflowId: 'workflow',
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
    approval: { approvePlan: vi.fn(), requestApprovalCode: vi.fn() },
    bookingProgress: { checkAddress: vi.fn() },
    residentialContext: { ready: false },
    residential: { waiting: false },
  } as unknown as ComponentProps<typeof OxygenProviderStages>;
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
it('offers refresh during address review, but not while pending or after payment/setup', () => {
  const booking = { status: 'BOOKED' };
  const { rerender } = render(
    <OxygenProviderStages {...props('booked', { booking })} />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh during address review' })
  );
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
  for (const [state, pending] of [
    [{ booking }, { action: 'book', status: 'queued' }],
    [{ booking, paymentComplete: true }, undefined],
    [{ booking, setupComplete: true }, undefined],
  ] as const) {
    rerender(<OxygenProviderStages {...props('booked', state, pending)} />);
    expect(
      screen.queryByRole('button', { name: 'Refresh during address review' })
    ).not.toBeInTheDocument();
  }
});
it('refreshes missing offers at approval and suppresses the action for an active command', () => {
  const state = { booking: { status: 'BOOKED' } };
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
      })}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Refresh saved offers' })
  ).not.toBeInTheDocument();
});
