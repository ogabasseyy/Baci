import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';
import { OxygenSavedPlans } from './OxygenSavedPlans';

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
const ref35 = '70000000-0000-4000-8000-000000000035';
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
it('shows selector and breakdown during the reconciliation hold and reuses 25% reference after 35% without provider mutations', async () => {
  let selected = ref25;
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('/plans')) {
      if (options?.method === 'POST')
        selected = JSON.parse(String(options.body)).bookingReference;
      return Response.json({
        selectedReference: selected,
        plans: [plan(ref25, 25), plan(ref35, 35)],
      });
    }
    return Response.json(
      url.includes('?')
        ? {
            workflowId: id,
            stage: 'reconciliation_required',
            version: 8,
            environment: 'staging',
            executionEnabled: true,
            state: { ...plan(ref25, 25).state },
            pending: {
              action: 'book',
              status: 'indeterminate',
              idempotencyKey: id,
            },
            approvalOtpReady: false,
            activationEnabled: false,
            settlementEnabled: false,
          }
        : { workflow: { id } }
    );
  });
  const view = render(<OxygenProviderFlow orderId={id} merchantSlug="shop" />);
  fireEvent.click(await screen.findByRole('button', { name: '35%' }));
  await waitFor(() => expect(selected).toBe(ref35));
  expect(screen.getByText('₦145,000.00')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '25%' }));
  await waitFor(() => expect(selected).toBe(ref25));
  expect(screen.getByText('₦105,000.00')).toBeVisible();
  expect(screen.getByText(ref25)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', {
      name: /cancel|change payment plan/i,
    })
  ).toBeNull();
  view.unmount();
  render(<OxygenProviderFlow orderId={id} merchantSlug="shop" />);
  await screen.findByText(ref25);
  expect(
    mocks.fetch.mock.calls.filter(
      ([url, o]) => o?.method === 'POST' && url.endsWith('/actions')
    )
  ).toHaveLength(0);
});
it('keeps an approved loan breakdown fixed instead of offering cached alternatives beside its payment link', async () => {
  const approved = {
    ...plan(ref35, 35).state,
    booking: {
      ...plan(ref35, 35).state.booking,
      status: 'APPROVED',
      equity_percentage: 50,
      equity_amount: 200000,
      loan_amount: 200000,
      total_charges: 5500,
      total_upfront_payment: 205500,
    },
    paymentUrl: 'https://payments.example.test/current',
  };
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json(
      url.includes('/plans')
        ? {
            selectedReference: ref25,
            plans: [plan(ref25, 25), plan(ref35, 35)],
          }
        : url.includes('?')
          ? {
              workflowId: id,
              stage: 'payment_required',
              version: 10,
              environment: 'staging',
              executionEnabled: false,
              state: approved,
              approvalOtpReady: false,
              activationEnabled: false,
              settlementEnabled: false,
            }
          : { workflow: { id } }
    )
  );
  render(<OxygenProviderFlow orderId={id} merchantSlug="shop" />);
  await screen.findByText('₦205,500.00');
  expect(screen.queryByRole('button', { name: '25%' })).toBeNull();
  expect(mocks.fetch.mock.calls.some(([url]) => url.includes('/plans'))).toBe(
    false
  );
});

it('finds cached plans from naira entry and hides stale fees for an uncached amount', async () => {
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      selectedReference: ref25,
      plans: [plan(ref25, 25), plan(ref35, 35)],
    })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  const input = await screen.findByLabelText('Your down payment');
  fireEvent.change(input, { target: { value: '140000' } });
  await screen.findByText(ref35);
  expect(screen.getByText('₦145,000.00')).toBeVisible();
  fireEvent.change(input, { target: { value: '150000' } });
  expect(
    screen.getByText(
      'Choose a period or tap “Show my plan” to see the confirmed figures.'
    )
  ).toBeVisible();
  expect(screen.queryByText('₦5,000.00')).toBeNull();
  expect(screen.queryByText('Repayment schedule')).toBeNull();
  expect(screen.queryByText(ref35)).toBeNull();
  expect(screen.getByRole('button', { name: 'Show my plan' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '25%' }));
  await screen.findByText(ref25);
  expect(screen.getByText('View payment dates')).toBeVisible();
  expect(mocks.fetch.mock.calls.every(([url]) => url.includes('/plans'))).toBe(
    true
  );
});

it('shows all eligible months, retrieves an uncached tenure once and reuses it after switching back', async () => {
  const ref6 = '70000000-0000-4000-8000-000000000006';
  const six = {
    ...plan(ref6, 25),
    tenure: 6,
    state: {
      ...plan(ref6, 25).state,
      booking: { ...plan(ref6, 25).state.booking, loan_tenure: 6 },
      schedule: Array.from({ length: 6 }, (_, i) => ({
        period: i + 1,
        dueDate: [2026, 11, i + 1],
        amount: 55000,
        principal: 50000,
        interest: 5000,
      })),
    },
  };
  let plans = [plan(ref25, 25)];
  let selected = ref25;
  let quotes = 0;
  mocks.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/quote')) {
      quotes++;
      plans = [...plans, six];
      selected = ref6;
    } else if (options?.method === 'POST')
      selected = JSON.parse(String(options.body)).bookingReference;
    return Response.json({ plans, selectedReference: selected });
  });
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        { ...plan(ref25, 25).state, maxTenure: 12 } as Parameters<
          typeof OxygenSavedPlans
        >[0]['state']
      }
    />
  );
  await screen.findByRole('radio', { name: '12 months' });
  fireEvent.click(screen.getByRole('radio', { name: '6 months' }));
  await screen.findByText(ref6);
  expect(quotes).toBe(1);
  fireEvent.click(screen.getByRole('radio', { name: '3 months' }));
  await screen.findByText(ref25);
  fireEvent.click(screen.getByRole('radio', { name: '6 months' }));
  await screen.findByText(ref6);
  expect(quotes).toBe(1);
  expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
});

it('reviews the saved plan locally without requesting an approval OTP or submitting approval', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  expect(
    await screen.findByRole('button', { name: 'Request approval code' })
  ).toBeDisabled();
  expect(
    screen.queryByRole('heading', { name: 'Confirm your payment plan' })
  ).toBeNull();
  expect(screen.getByText(/No approval will be submitted/)).toBeVisible();
  expect(mocks.fetch.mock.calls.every(([url]) => url.includes('/plans'))).toBe(
    true
  );
});

it('does not flash canonical amounts while loading saved choices', () => {
  mocks.fetch.mockReturnValue(new Promise(() => {}));
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  expect(screen.getByRole('region', { name: 'Plan summary' })).toHaveAttribute(
    'aria-busy',
    'true'
  );
  expect(screen.queryByText(/₦/)).toBeNull();
});

it('does not repeat the repayment count as a disconnected footer label', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ selectedReference: ref25, plans: [plan(ref25, 25)] })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  await screen.findByRole('button', { name: 'Request approval code' });
  expect(screen.queryByText('3 monthly payments')).toBeNull();
  expect(
    screen.getByRole('region', { name: 'Plan summary' })
  ).toHaveTextContent('3 months');
});

it('keeps approval on the plan screen disabled and follows the exact selected cached reference', async () => {
  mocks.fetch.mockImplementation(async (_url: string, options?: RequestInit) =>
    Response.json({
      selectedReference:
        options?.method === 'POST'
          ? JSON.parse(String(options.body)).bookingReference
          : ref25,
      plans: [plan(ref25, 25), plan(ref35, 35)],
    })
  );
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
    />
  );
  fireEvent.click(await screen.findByRole('button', { name: '35%' }));
  expect(
    screen.getByRole('button', { name: 'Request approval code' })
  ).toBeDisabled();
  expect(screen.getByText('₦145,000.00')).toBeVisible();
  expect(screen.getByText(ref35)).toBeInTheDocument();
  expect(
    screen.queryByRole('region', { name: 'Confirm selected plan' })
  ).toBeNull();
  expect(screen.getByRole('slider')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '25%' }));
  expect(screen.getByText(ref25)).toBeInTheDocument();
  expect(screen.getByText('₦105,000.00')).toBeVisible();
  expect(
    mocks.fetch.mock.calls.every(
      ([url]) => !url.includes('/actions') && !url.includes('/quote')
    )
  ).toBe(true);
});

it('resumes the already requested code screen without sending another code or exposing approval submission', async () => {
  const sentAt = Date.now();
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json(
      url.includes('/approval-code')
        ? {
            window: {
              bookingReference: ref25,
              sentAt: new Date(sentAt).toISOString(),
              expiresAt: new Date(sentAt + 300000).toISOString(),
            },
          }
        : { selectedReference: ref25, plans: [plan(ref25, 25)] }
    )
  );
  const request = vi.fn();
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
      approvalReference={ref25}
      requestApprovalCode={request}
    />
  );
  expect(
    screen.getByRole('heading', { name: 'Verify your payment plan' })
  ).toBeVisible();
  expect(
    screen.getByRole('textbox', { name: 'Verification code' })
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Verify and approve plan' })
  ).toBeNull();
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Verification code' })
    ).toBeEnabled()
  );
  expect(
    screen.getByRole('textbox', { name: 'Verification code' })
  ).toHaveAttribute('readonly');
  expect(screen.queryByRole('button', { name: /preview/i })).toBeNull();
  expect(screen.queryByText(/Approval is paused/)).toBeNull();
  expect(document.querySelector('[data-animation-preview="true"]')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Verify and approve plan' })
  ).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it('requests a code only for the matching canonical selected reference', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({
      selectedReference: ref25,
      plans: [plan(ref25, 25), plan(ref35, 35)],
    })
  );
  const request = vi.fn().mockResolvedValue(true);
  render(
    <OxygenSavedPlans
      workflowId={id}
      state={
        plan(ref25, 25).state as Parameters<typeof OxygenSavedPlans>[0]['state']
      }
      requestApprovalCode={request}
    />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Request approval code' })
  );
  expect(request).toHaveBeenCalledExactlyOnceWith(ref25);
  fireEvent.click(screen.getByRole('button', { name: '35%' }));
  expect(
    screen.getByRole('button', { name: 'Request approval code' })
  ).toBeDisabled();
});

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
      const form = options.body as FormData;
      commands.push(JSON.parse(String(form.get('payload'))));
      expect(form.get('file')).toBeInstanceOf(File);
      return Response.json({
        ...initial,
        version: 9,
        stage: 'payment_required',
        state: {
          ...initial.state,
          booking: { ...initial.state.booking, status: 'APPROVED' },
          paymentUrl: 'https://example.com/payment',
        },
      });
    }
    return Response.json(url.includes('?') ? initial : { workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} />);
  await screen.findByRole('heading', { name: 'Verify your payment plan' });
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Verification code' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  fireEvent.change(screen.getByLabelText('Your signature'), {
    target: {
      files: [new File(['signature'], 'signature.png', { type: 'image/png' })],
    },
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I accept this payment plan/ })
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Verification code' }), {
    target: { value: '123456' },
  });
  await screen.findByText('Code verified.');
  expect(screen.queryByRole('link', { name: 'Pay upfront amount' })).toBeNull();
  await screen.findByRole('link', { name: 'Pay upfront amount' });
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    workflowId: id,
    version: 8,
    command: { action: 'approve_booking', otp: '123456', accepted: true },
  });
  expect(
    screen.queryByRole('heading', { name: 'Verify your payment plan' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: /activate|settle|cancel/i })
  ).toBeNull();
});

it('shows one reconciliation screen after indeterminate approval without returning to the plan selector', async () => {
  const snapshot = {
    workflowId: id,
    stage: 'reconciliation_required',
    version: 10,
    environment: 'staging',
    executionEnabled: true,
    state: plan(ref25, 25).state,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    pending: {
      action: 'approve_booking',
      status: 'indeterminate',
      idempotencyKey: id,
    },
  };
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json(
      url.includes('/draft?')
        ? { draft: null, version: 0 }
        : url.includes('/plans')
          ? { selectedReference: ref25, plans: [plan(ref25, 25)] }
          : url.includes('?')
            ? snapshot
            : { workflow: { id } }
    )
  );
  render(<OxygenProviderFlow orderId={id} />);
  await screen.findByRole('heading', {
    name: 'Your application is being checked',
  });
  expect(
    screen.queryByRole('heading', { name: 'Choose your payment plan' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Request approval code' })
  ).toBeNull();
  expect(screen.queryByRole('link', { name: 'Pay upfront amount' })).toBeNull();
  expect(mocks.fetch.mock.calls.some(([url]) => url.includes('/plans'))).toBe(
    false
  );
  expect(
    mocks.fetch.mock.calls.some(
      ([url, options]) => url.endsWith('/actions') && options?.method === 'POST'
    )
  ).toBe(false);
});
