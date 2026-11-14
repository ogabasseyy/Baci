import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';
import { OxygenSelfieConfirmedContext } from './OxygenPaymentSurfaceContext';

const base: OxygenRuntimeSnapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  stage: 'eligibility_required',
  version: 2,
  environment: 'staging',
  executionEnabled: true,
  state: { validated: true },
  approvalOtpReady: false,
  checkoutPhone: '',
  checkoutAddress: {},
  activationEnabled: false,
  settlementEnabled: false,
};
const kyc = {
  bvn_status: 'DONE',
  nin_status: 'DONE',
  bank_status: 'DONE',
  phone_status: 'DONE',
  selfie_status: 'NOT_DONE',
  address_status: 'NOT_DONE',
} as const;

it('does not show a running-check spinner after a failed check', () => {
  render(
    <OxygenGuidedVerification
      snapshot={base}
      busy={false}
      error="Unable to confirm"
      submit={vi.fn()}
    />
  );
  expect(screen.queryByRole('status')).toBeNull();
});

it('prepares the selfie before eligibility while selfie verification is missing', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenGuidedVerification
      snapshot={{ ...base, state: { validated: true, kyc } }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'selfie_link' })
  );
  expect(submit).not.toHaveBeenCalledWith({ action: 'refresh_eligibility' });
});

it('does not start background checks while the application popup is closed', async () => {
  const submit = vi.fn().mockResolvedValue(true);
  const view = render(
    <OxygenGuidedVerification
      snapshot={base}
      busy={false}
      error=""
      submit={submit}
      enabled={false}
    />
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(submit).not.toHaveBeenCalled();
  view.rerender(
    <OxygenGuidedVerification
      snapshot={base}
      busy={false}
      error=""
      submit={submit}
      enabled
    />
  );
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith({ action: 'refresh_kyc' })
  );
});

it('shows a recoverable service error and retries only eligibility once on click', async () => {
  const submit = vi.fn(() => new Promise<boolean>(() => {}));
  render(
    <OxygenGuidedVerification
      snapshot={{
        ...base,
        state: {
          validated: true,
          kyc: { ...kyc, selfie_status: 'DONE' },
          eligibilityStatus: 'failed',
        },
      }}
      busy={false}
      error=""
      submit={submit}
    />
  );
  expect(
    screen.getByRole('heading', {
      name: 'We couldn’t finish checking your payment options',
    })
  ).toBeVisible();
  expect(screen.queryByText(/under review/i)).toBeNull();
  expect(screen.queryByText(/No installment plan/)).toBeNull();
  expect(submit).not.toHaveBeenCalled();
  const retry = screen.getByRole('button', { name: 'Try again' });
  retry.click();
  retry.click();
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit).toHaveBeenCalledWith({ action: 'refresh_eligibility' });
});

it('shows identity loading after phone verification without claiming payment options are ready', () => {
  render(
    <OxygenGuidedVerification snapshot={base} busy error="" submit={vi.fn()} />
  );
  expect(
    screen.getByRole('heading', { name: 'Checking your BVN' })
  ).toBeVisible();
  expect(
    screen.queryByText(
      'We’re checking your available payment options with Oxygen.'
    )
  ).toBeNull();
});

it('keeps a confirmed selfie return in loading while the saved KYC snapshot catches up', () => {
  const submit = vi.fn();
  render(
    <OxygenSelfieConfirmedContext.Provider value={base.workflowId}>
      <OxygenGuidedVerification
        snapshot={{
          ...base,
          stage: 'kyc_required',
          state: {
            validated: true,
            kyc,
            selfieUrl: 'https://verify.example/selfie',
          },
        }}
        busy
        error=""
        submit={submit}
      />
    </OxygenSelfieConfirmedContext.Provider>
  );
  expect(
    screen.getByRole('heading', { name: 'Confirming your identity' })
  ).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Continue to selfie verification' })
  ).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});
