import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';

it('identifies the unconfirmed bank instead of implying completed identity checks are still running', () => {
  const submit = vi.fn();
  render(
    <OxygenGuidedVerification
      busy
      error=""
      submit={submit}
      snapshot={{
        workflowId: '60000000-0000-4000-8000-000000000001',
        stage: 'kyc_required',
        version: 4,
        environment: 'staging',
        executionEnabled: true,
        state: {
          validated: true,
          eligible: true,
          eligibilityStatus: 'completed',
          kyc: {
            phone_status: 'DONE',
            bvn_status: 'DONE',
            nin_status: 'DONE',
            selfie_status: 'DONE',
            bank_status: 'NOT_DONE',
            address_status: 'NOT_DONE',
          },
        },
        checkoutPhone: '',
        checkoutAddress: {},
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      }}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'Confirming your bank details' })
  ).toBeVisible();
  expect(
    screen.getByText(/Oxygen has not confirmed your bank account/)
  ).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
});
