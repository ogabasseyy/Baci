import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: fetcher }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));
vi.mock('./use-oxygen-confirmation-updates', () => ({
  useOxygenConfirmationUpdates: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

it.each([
  'queued',
  'executing',
  'indeterminate',
] as const)('handles a %s booking command without replaying an uncertain request', async (status) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const pending = {
    workflowId,
    stage: 'plan_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      applicationReference: workflowId,
      validated: true,
      eligible: true,
      kyc: {
        address_status: 'NOT_DONE',
        bvn_status: 'DONE',
        nin_status: 'DONE',
        bank_status: 'NOT_DONE',
        phone_status: 'DONE',
        selfie_status: 'DONE',
      },
    },
    pending: {
      action: 'book',
      status,
      idempotencyKey: key,
      ...(status === 'queued'
        ? { bookingTerms: { equityPercentage: 35, tenure: 6 } }
        : {}),
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const commands: {
    idempotencyKey: string;
    equityPercentage: number;
    tenure: number;
  }[] = [];
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?')) return Response.json(pending);
    if (url.endsWith('/plans/quote') && options?.method === 'POST') {
      commands.push(JSON.parse(String(options.body)));
      return Response.json({
        ...pending,
        version: 4,
        pending: null,
        state: { ...pending.state, eligible: true },
      });
    }
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  const button = await screen.findByRole('button', {
    name: status === 'queued' ? 'Continue payment plan' : 'Check for an update',
  });
  const statusReadsBeforeClick = fetcher.mock.calls.filter(([url]) =>
    String(url).includes('/workflows/actions?')
  ).length;
  expect(commands).toHaveLength(0);
  fireEvent.click(button);
  if (status === 'queued') {
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      idempotencyKey: key,
      equityPercentage: 35,
      tenure: 6,
    });
  } else {
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([url]) =>
          String(url).includes('/workflows/actions?')
        ).length
      ).toBeGreaterThan(statusReadsBeforeClick)
    );
    expect(commands).toHaveLength(0);
  }
});

it.each([
  'initial',
  'comparison',
] as const)('resumes a queued %s booking and shows its confirmed breakdown', async (kind) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const key = '70000000-0000-4000-8000-000000000001';
  const reference = '70000000-0000-4000-8000-000000000035';
  const oldReference = '70000000-0000-4000-8000-000000000025';
  const booking = {
    loan_reference: reference,
    status: 'BOOKED',
    product_amount: 400000,
    equity_percentage: 35,
    equity_amount: 140000,
    loan_amount: 260000,
    loan_tenure: 6,
  };
  const state = {
    applicationReference: workflowId,
    validated: true,
    eligible: true,
    bookingReference: reference,
    booking,
    quotedCharges: 5000,
    schedule: Array.from({ length: 6 }, (_, i) => ({
      period: i + 1,
      dueDate: [2027, i + 1, 27],
      amount: 45000,
      principal: 40000,
      interest: 5000,
    })),
  };
  const plan = {
    bookingReference: reference,
    productAmount: 400000,
    equityPercentage: 35,
    tenure: 6,
    state: {
      bookingReference: reference,
      booking,
      quotedCharges: 5000,
      schedule: state.schedule,
    },
    updatedAt: '2026-10-23T12:00:00Z',
  };
  const pending = {
    workflowId,
    stage: kind === 'initial' ? 'plan_required' : 'approval_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state:
      kind === 'initial'
        ? { applicationReference: workflowId, validated: true, eligible: true }
        : {
            ...state,
            bookingReference: oldReference,
            booking: {
              ...booking,
              loan_reference: oldReference,
              equity_percentage: 25,
              equity_amount: 100000,
              loan_amount: 300000,
              loan_tenure: 3,
            },
          },
    pending: {
      action: 'book',
      status: 'queued',
      idempotencyKey: key,
      bookingTerms: { equityPercentage: 35, tenure: 6 },
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  const completed = {
    ...pending,
    stage: 'booked',
    version: 5,
    state,
    pending: null,
  };
  let complete = false;
  let release!: () => void;
  const requests: unknown[] = [];
  fetcher.mockReset();
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/workflows'))
      return Response.json({ workflow: { id: workflowId } });
    if (url.includes('/workflows/actions?'))
      return Response.json(complete ? completed : pending);
    if (url.endsWith('/plans/quote')) {
      requests.push(JSON.parse(String(options?.body)));
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      complete = true;
      return Response.json({ plans: [plan], selectedReference: reference });
    }
    if (url.endsWith('/plans/accept')) {
      requests.push(JSON.parse(String(options?.body)));
      return Response.json({ ok: true });
    }
    if (url.includes('/plans?'))
      return Response.json({ plans: [plan], selectedReference: reference });
    return Response.json({ draft: null, version: 0 });
  });
  render(<OxygenProviderFlow orderId={workflowId} />);
  const button = await screen.findByRole('button', {
    name: 'Continue payment plan',
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    workflowId,
    idempotencyKey: key,
    equityPercentage: 35,
    tenure: 6,
  });
  release();
  expect(
    await screen.findByRole('heading', { name: 'Review your payment plan' })
  ).toBeVisible();
  expect(screen.getByText('₦145,000.00')).toBeVisible();
  expect(screen.getAllByText('₦45,000.00')[0]).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Accept payment plan' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({
    workflowId,
    bookingReference: reference,
    version: 5,
  });
});
