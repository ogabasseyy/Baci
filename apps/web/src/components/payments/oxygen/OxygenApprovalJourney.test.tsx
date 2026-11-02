import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  mocks.fetch.mockReset();
});
const id = '60000000-0000-4000-8000-000000000001';
const ref25 = '70000000-0000-4000-8000-000000000025';
function plan(ref: string, equity: number) {
  return {
    bookingReference: ref,
    productAmount: 400000,
    equityPercentage: equity,
    tenure: 3,
    state: {
      bookingReference: ref,
      booking: {
        loan_reference: ref,
        status: 'BOOKED',
        product_amount: 400000,
        equity_percentage: equity,
        equity_amount: 4000 * equity,
        loan_amount: 400000 - 4000 * equity,
        loan_tenure: 3,
      },
      quotedCharges: 5000,
      schedule: [1, 2, 3].map((period) => ({
        period,
        dueDate: [2026, 10 + period, 27],
        amount: 110000,
        principal: 100000,
        interest: 10000,
      })),
    },
    updatedAt: '2026-10-23T12:00:00Z',
  };
}
it('sends the selected plan approval with its signature and advances only after the confirmed response', async () => {
  const sentAt = Date.now();
  const initial = {
    workflowId: id,
    stage: 'approval_required',
    version: 8,
    environment: 'staging',
    executionEnabled: true,
    state: plan(ref25, 25).state,
    approvalOtpReady: true,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: unknown[] = [];
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('/recovery'))
      return Response.json({
        reference: ref25,
        paymentComplete: false,
        setupComplete: false,
        paymentUrl: 'https://payment.hydrogenpay.com/?transactionId=synthetic',
        setupUrl: null,
        checkedAt: null,
        lastOutcome: null,
        pending: false,
      });
    if (url.includes('/draft?'))
      return Response.json({ draft: null, version: 0 });
    if (url.includes('/approval-code?'))
      return Response.json({
        window: {
          bookingReference: ref25,
          sentAt: new Date(sentAt).toISOString(),
          expiresAt: new Date(sentAt + 300000).toISOString(),
        },
      });
    if (url.includes('/plans'))
      return Response.json({
        selectedReference: ref25,
        plans: [plan(ref25, 25)],
      });
    if (url.endsWith('/actions') && options?.method === 'POST') {
      if (typeof options.body === 'string') {
        const payload = JSON.parse(options.body);
        if (payload.command.action === 'refresh_payment_setup')
          return Response.json({
            ...initial,
            version: 11,
            stage: 'payment_required',
            state: {
              ...initial.state,
              booking: { ...initial.state.booking, status: 'APPROVED' },
              paymentUrl:
                'https://payment.hydrogenpay.com/?transactionId=synthetic',
            },
          });
        commands.push(payload);
        return Response.json({ ...initial, version: 9 });
      }
      const form = options.body as FormData;
      commands.push(JSON.parse(String(form.get('payload'))));
      expect(form.get('file')).toBeInstanceOf(File);
      return Response.json({
        ...initial,
        version: 10,
        stage: 'payment_required',
        state: {
          ...initial.state,
          booking: { ...initial.state.booking, status: 'APPROVED' },
          paymentUrl:
            'https://payment.hydrogenpay.com/?transactionId=synthetic',
        },
      });
    }
    return Response.json(url.includes('?') ? initial : { workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} />);
  await screen.findByRole('heading', {
    name: 'Sign and accept your payment plan',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: {
      files: [new File(['signature'], 'signature.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I accept this payment plan/ })
  );
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Verification code' })
    ).toBeEnabled()
  );
  expect(commands).toHaveLength(1);
  fireEvent.change(screen.getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
  await screen.findByText('Code verified.');
  expect(
    screen.queryByRole('button', { name: 'Continue to payment' })
  ).toBeNull();
  expect(
    await screen.findByTitle('Oxygen secure payment', {}, { timeout: 2500 })
  ).toHaveAttribute(
    'src',
    'https://payment.hydrogenpay.com/?transactionId=synthetic'
  );
  expect(
    screen.queryByRole('heading', { name: 'Your payment plan' })
  ).toBeNull();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toMatchObject({
    command: { action: 'trigger_approval_otp' },
  });
  expect(commands[1]).toMatchObject({
    workflowId: id,
    version: 9,
    command: { action: 'approve_booking', otp: '123456', accepted: true },
  });
  expect(
    screen.queryByRole('heading', { name: 'Sign and accept your payment plan' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: /activate|settle|cancel/i })
  ).toBeNull();
});
