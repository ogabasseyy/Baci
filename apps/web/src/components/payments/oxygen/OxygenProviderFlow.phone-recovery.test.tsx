import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), capture: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/contexts/customer-auth-context', () => ({
  CustomerAuthProvider: ({ children }: { children: ReactNode }) => children,
  useCustomerAuth: () => ({
    isLoading: false,
    isAuthenticated: false,
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
  }),
}));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: mocks.capture,
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';
import { installOxygenOtpTestEnvironment } from './oxygen-otp-test-environment.test-support';
import { readPhoneOtpSend } from './phone-otp-window';

installOxygenOtpTestEnvironment();

it('clears a stale request error after a successful status refresh', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  let reads = 0;
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.includes('?')) {
      reads++;
      return Response.json({
        workflowId: id,
        stage: reads === 2 ? 'reconciliation_required' : 'eligibility_required',
        version: reads,
        environment: 'staging',
        executionEnabled: true,
        state: { applicationReference: id },
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      });
    }
    if (url.endsWith('/actions'))
      return Response.json({ error: 'unconfirmed' }, { status: 409 });
    return Response.json({ workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resend code' }));
  const refresh = await screen.findByRole('button', {
    name: 'Check for an update',
  });
  expect(
    screen.getByRole('heading', { name: 'Your application is being checked' })
  ).toBeVisible();
  expect(
    screen.queryByText(/previous step|refresh your saved status/i)
  ).toBeNull();
  fireEvent.click(refresh);
  await screen.findByRole('form', { name: 'Verify phone' });
  expect(
    screen.queryByText(
      'Unable to confirm this step. Refresh your saved status before continuing.'
    )
  ).toBeNull();
});

it.each([
  ['accepted', 2, null, 200, true],
  ['queued', 1, 'queued', 200, false],
  ['executing', 1, 'executing', 200, false],
  ['indeterminate', 2, 'indeterminate', 200, false],
  ['unchanged', 1, null, 200, false],
  ['failed', 1, null, 409, false],
] as const)('confirms an OTP resend only after acknowledgment (%s)', async (_outcome, version, status, httpStatus, confirmed) => {
  const suffix =
    [
      'accepted',
      'queued',
      'executing',
      'indeterminate',
      'unchanged',
      'failed',
    ].indexOf(_outcome) + 1;
  const id = `60000000-0000-4000-8100-${String(suffix).padStart(12, '0')}`;
  const snapshot = {
    workflowId: id,
    stage: 'eligibility_required',
    version: 1,
    environment: 'staging',
    executionEnabled: true,
    state: { applicationReference: id },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST')
      return Response.json(
        {
          ...snapshot,
          version,
          pending: status
            ? { action: 'resend_customer_otp', status, idempotencyKey: id }
            : null,
        },
        { status: httpStatus }
      );
    return Response.json(url.includes('?') ? snapshot : { workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Resend code' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Sending code…' })).toBeNull()
  );
  expect(readPhoneOtpSend(id) !== undefined).toBe(confirmed);
  if (confirmed)
    expect(
      screen.getByText('A new code has been sent. Check your phone.')
    ).toBeVisible();
  else
    expect(
      screen.queryByText('A new code has been sent. Check your phone.')
    ).toBeNull();
});

it('offers clear OTP recovery after a failed verification without retrying the code', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  let attempts = 0;
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST') {
      attempts += 1;
      return Response.json(
        { code: 'OXYGEN_OTP_INVALID', error: 'private raw provider response' },
        { status: 409 }
      );
    }
    return Response.json(
      url.includes('?')
        ? {
            workflowId: id,
            stage: 'eligibility_required',
            version: attempts + 1,
            environment: 'staging',
            executionEnabled: true,
            state: { applicationReference: id },
            approvalOtpReady: false,
            pending: null,
            activationEnabled: false,
            settlementEnabled: false,
          }
        : { workflow: { id } }
    );
  });
  render(<OxygenProviderFlow orderId={id} />);
  fireEvent.change(await screen.findByLabelText('Verification code'), {
    target: { value: '123456' },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'That code isn’t valid. Check the six digits or request a new code.'
  );
  expect(attempts).toBe(1);
  const input = screen.getByLabelText('Verification code');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute(
    'aria-describedby',
    screen.getByRole('alert').id
  );
  expect(
    screen.queryByRole('button', { name: /Try again|Check for an update/ })
  ).toBeNull();
  expect(screen.queryByText('private raw provider response')).toBeNull();
  fireEvent.change(input, { target: { value: '1' } });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(attempts).toBe(1);
});
