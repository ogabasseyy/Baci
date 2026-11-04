import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

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

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterAll(() => vi.unstubAllGlobals());

it.each([
  'APPROVED',
  'BOOKED',
])('shows one product and no repeated breakdown after payment confirmation (%s)', async (bookingStatus) => {
  const id = '60000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string) =>
    url.startsWith('/api/payments/oxygen/draft?')
      ? Response.json({ draft: null, version: 0 })
      : url.includes('?')
        ? Response.json({
            workflowId: id,
            stage: 'ready_for_activation',
            version: 5,
            environment: 'staging',
            executionEnabled: true,
            state: {
              bookingReference: reference,
              paymentComplete: true,
              setupComplete: true,
              booking: {
                loan_reference: reference,
                status: bookingStatus,
                product_amount: 198000,
                equity_percentage: 25,
                equity_amount: 49500,
                loan_amount: 148500,
                loan_tenure: 3,
                total_charges: 2932.88,
                total_upfront_payment: 52432.88,
              },
              schedule: [
                {
                  period: 1,
                  dueDate: [2026, 11, 27],
                  amount: 55658,
                  principal: 0,
                  interest: 0,
                },
              ],
            },
            approvalOtpReady: false,
            activationEnabled: false,
            settlementEnabled: false,
          })
        : Response.json({ workflow: { id } })
  );
  render(
    <OxygenProviderFlow
      orderId={id}
      products={[
        {
          id: 'a16',
          name: 'Samsung Galaxy A16 LTE',
          quantity: 1,
          price: 198000,
        },
      ]}
    />
  );
  await screen.findByRole('heading', { name: 'Payment confirmed' });
  expect(screen.getAllByText('Samsung Galaxy A16 LTE')).toHaveLength(1);
  expect(
    screen.queryByRole('heading', { name: 'Your payment plan' })
  ).toBeNull();
  expect(screen.queryByText('Repayment schedule')).toBeNull();
  expect(screen.queryByText('View selected plan')).toBeNull();
});

it('shows the booked breakdown before the address form and keeps acceptance separate from approval', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000025';
  const snapshot = {
    workflowId: id,
    stage: 'booked',
    version: 30,
    environment: 'staging',
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    state: {
      bookingReference: reference,
      booking: {
        status: 'BOOKED',
        loan_reference: reference,
        product_amount: 198000,
        equity_amount: 49500,
        equity_percentage: 25,
        loan_amount: 148500,
        loan_tenure: 3,
      },
      quotedCharges: 2932.88,
      schedule: [
        {
          period: 1,
          dueDate: [2026, 11, 26],
          amount: 55442,
          principal: 46695.35,
          interest: 8746.65,
        },
      ],
      kyc: {
        phone_status: 'DONE',
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'DONE',
        selfie_status: 'DONE',
        address_status: 'NOT_DONE',
      },
    },
  };
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.includes('/draft'))
      return Response.json({ draft: null, version: 0 });
    if (url.endsWith('/actions'))
      return Response.json({ ...snapshot, version: 31 });
    return Response.json(url.includes('?') ? snapshot : { workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} />);
  expect(
    await screen.findByRole('heading', { name: 'Your payment breakdown' })
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Continue verification' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Accept payment plan' }));
  expect(
    await screen.findByRole('button', { name: 'Continue verification' })
  ).toBeVisible();
  expect(
    mocks.fetch.mock.calls.filter(
      ([, options]) =>
        options?.method === 'POST' &&
        /approve_booking|trigger_approval_otp|submit_address|cancel_booking/.test(
          String(options.body)
        )
    )
  ).toHaveLength(0);
});

it('reopens a canonically activated plan without old approval recovery or payment controls', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (url: string) =>
    url.includes('/draft')
      ? Response.json({ draft: null, version: 0 })
      : url.includes('?')
        ? Response.json({
            workflowId: id,
            stage: 'activated',
            version: 40,
            environment: 'staging',
            executionEnabled: true,
            activationEnabled: false,
            settlementEnabled: false,
            approvalOtpReady: false,
            state: {
              bookingReference: '70000000-0000-4000-8000-000000000001',
              paymentComplete: true,
              setupComplete: true,
            },
            pending: {
              action: 'approve_booking',
              status: 'indeterminate',
              idempotencyKey: '80000000-0000-4000-8000-000000000001',
            },
          })
        : Response.json({ workflow: { id } })
  );
  render(<OxygenProviderFlow orderId={id} />);
  expect(
    await screen.findByRole('region', { name: 'Completed Oxygen application' })
  ).toBeVisible();
  expect(
    screen.queryByRole('button', {
      name: /Continue to payment|Request approval|Check for an update/i,
    })
  ).toBeNull();
  expect(
    mocks.fetch.mock.calls.some(([, options]) =>
      /activate|approve_booking/.test(String(options?.body))
    )
  ).toBe(false);
});
