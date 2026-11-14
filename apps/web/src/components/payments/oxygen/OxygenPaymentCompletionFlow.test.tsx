import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ provider: vi.fn(), recovery: vi.fn() }));
vi.mock('./use-oxygen-provider', () => ({ useOxygenProvider: mocks.provider }));
vi.mock('./use-oxygen-payment-recovery', () => ({
  useOxygenPaymentRecovery: mocks.recovery,
}));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';
import { OxygenProviderFlow } from './OxygenProviderFlow';

const workflow = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000001';
const base = {
  workflowId: workflow,
  version: 4,
  environment: 'staging' as const,
  executionEnabled: true,
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  state: {
    bookingReference: reference,
    paymentComplete: true,
    setupComplete: true,
  },
};

it.each([
  'ready_for_activation',
  'payment_required',
] as const)('reads canonical state and redirects after activation from %s', async (stage) => {
  const read = vi.fn();
  const redirect = vi.fn();
  mocks.provider.mockImplementation(() => {
    const [snapshot, setSnapshot] = useState({ ...base, stage });
    return {
      snapshot,
      busy: false,
      error: '',
      errorAction: null,
      clearError: vi.fn(),
      submit: vi.fn(),
      refresh: vi.fn(),
      needsSignIn: false,
      readSaved: async () => {
        read();
        setSnapshot({ ...base, stage: 'activated' as typeof stage });
      },
    };
  });
  mocks.recovery.mockReturnValue({
    state: { paymentComplete: true, setupComplete: true, pending: false },
    busy: false,
    error: '',
    run: vi.fn(),
    checkStatus: vi.fn(),
    closePayment: vi.fn(),
  });
  render(
    <OxygenOrderConfirmationContext.Provider value={redirect}>
      <OxygenProviderFlow orderId={workflow} />
    </OxygenOrderConfirmationContext.Provider>
  );
  await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
  expect(read).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('heading', { name: 'Payment plan confirmed' })
  ).toBeVisible();
  expect(
    mocks.recovery.mock.results.every(
      (result) => !result.value?.run?.mock?.calls.length
    )
  ).toBe(true);
});
