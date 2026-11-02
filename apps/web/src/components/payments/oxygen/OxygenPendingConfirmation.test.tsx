import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import { OxygenPendingConfirmation } from './OxygenPendingConfirmation';

const reference = '70000000-0000-4000-8000-000000000001';
const workflowId = '60000000-0000-4000-8000-000000000001';
const pending = (action: string, addressStatus?: 'PROCESSING') =>
  oxygenRuntimeSnapshotSchema.parse({
    workflowId,
    stage: 'reconciliation_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      bookingReference: reference,
      ...(addressStatus
        ? {
            kyc: {
              address_status: addressStatus,
              bvn_status: 'DONE',
              nin_status: 'DONE',
              bank_status: 'DONE',
              phone_status: 'DONE',
              selfie_status: 'DONE',
            },
          }
        : {}),
    },
    pending: { action, status: 'indeterminate', idempotencyKey: workflowId },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  });
const common = {
  awaitingConfirmation: true,
  needsSignIn: false,
  busy: false,
  error: '',
  selfieConfirmed: false,
  setComparingPlans: vi.fn(),
};

it('keeps an indeterminate approval in saved status recovery without offering another code', () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenPendingConfirmation
      {...common}
      snapshot={pending('approve_booking')}
      refresh={refresh}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'We couldn’t confirm your approval' })
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /send.*code/i })).toBeNull();
});
it('keeps an address under review on status recovery without replacement upload', () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <OxygenPendingConfirmation
      {...common}
      snapshot={pending('refresh_kyc', 'PROCESSING')}
      refresh={refresh}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'Oxygen is reviewing your address' })
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: /upload another/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  expect(refresh).toHaveBeenCalledOnce();
});
