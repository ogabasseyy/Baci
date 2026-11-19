import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

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
afterEach(() => {
  if (vi.isFakeTimers()) {
    // input-otp schedules selection synchronization after the input event.
    act(() => vi.advanceTimersByTime(50));
    vi.useRealTimers();
  }
});

it('shows a bank statement requirement after a rejected booking without claiming identity is unverified', async () => {
  mocks.fetch.mockClear();
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST')
      return Response.json(
        {
          code: 'OXYGEN_STATEMENT_REQUIRED',
          error: 'untrusted private provider detail',
        },
        { status: 409 }
      );
    if (url.includes('?'))
      return Response.json({
        workflowId: id,
        stage: 'plan_required',
        version: 3,
        environment: 'staging',
        executionEnabled: true,
        state: {
          validated: true,
          eligible: true,
          eligibleAmount: 396000,
          minimumAmount: 10000,
          maxTenure: 12,
          offers: [{ tenure: 3, loanAmount: 396000 }],
        },
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      });
    return Response.json({ workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} productAmount={396000} />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'See full breakdown' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'See full breakdown' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Oxygen needs a valid bank statement'
    )
  );
  expect(
    screen.getByRole('heading', {
      name: 'We couldn’t prepare your payment plan',
    })
  ).toBeVisible();
  expect(
    screen.queryByText(/Oxygen hasn’t confirmed your details/)
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/untrusted private provider detail/)
  ).not.toBeInTheDocument();
  expect(
    mocks.fetch.mock.calls.filter(
      ([url, opts]) => url.endsWith('/actions') && opts?.method === 'POST'
    )
  ).toHaveLength(1);
});

it('shows one safe waiting state for an uncertain booking and refreshes without resubmitting', async () => {
  mocks.fetch.mockClear();
  const id = '60000000-0000-4000-8000-000000000001';
  let bookingSent = false;
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST') {
      bookingSent = true;
      return Response.json(
        { error: 'private upstream HTTP 500' },
        { status: 409 }
      );
    }
    if (!url.includes('?')) return Response.json({ workflow: { id } });
    return Response.json({
      workflowId: id,
      stage: bookingSent ? 'reconciliation_required' : 'plan_required',
      version: bookingSent ? 4 : 3,
      environment: 'staging',
      executionEnabled: true,
      state: {
        validated: true,
        eligible: true,
        eligibleAmount: 396000,
        minimumAmount: 10000,
        maxTenure: 12,
        offers: [{ tenure: 3, loanAmount: 396000 }],
      },
      approvalOtpReady: false,
      pending: bookingSent
        ? { action: 'book', status: 'indeterminate', idempotencyKey: id }
        : null,
      activationEnabled: false,
      settlementEnabled: false,
    });
  });
  render(<OxygenProviderFlow orderId={id} productAmount={396000} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'See full breakdown' })
  );
  await screen.findByRole('heading', {
    name: 'Your payment plan is being confirmed',
  });
  expect(
    screen.queryByText(
      /Previous step|refresh the saved|contact support|hasn’t confirmed your details|private upstream/i
    )
  ).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Try again|See full breakdown/ })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for an update' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check for an update' })
    ).toBeEnabled()
  );
  expect(
    mocks.fetch.mock.calls.filter(
      ([url, opts]) => url.endsWith('/actions') && opts?.method === 'POST'
    )
  ).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /activate|settle/i })).toBeNull();
});

it('does not call an unconfirmed code incorrect when the provider check is unavailable', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST')
      return Response.json({}, { status: 503 });
    return Response.json(
      url.includes('?')
        ? {
            workflowId: id,
            stage: 'eligibility_required',
            version: 1,
            environment: 'staging',
            executionEnabled: true,
            state: { applicationReference: id },
            approvalOtpReady: false,
            activationEnabled: false,
            settlementEnabled: false,
          }
        : { workflow: { id } }
    );
  });
  render(<OxygenProviderFlow orderId={id} />);
  const input = await screen.findByLabelText('Verification code');
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.change(input, { target: { value: '123456' } });
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'We couldn’t check your code right now. Please try again shortly.'
  );
  expect(screen.queryByText(/code isn’t valid/)).toBeNull();
});

it('shows the safe active-loan reason and support action without offering another booking', async () => {
  mocks.fetch.mockClear();
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST')
      return Response.json(
        {
          code: 'OXYGEN_ACTIVE_LOAN',
          error: 'untrusted private provider detail',
        },
        { status: 409 }
      );
    if (url.includes('?'))
      return Response.json({
        workflowId: id,
        stage: 'plan_required',
        version: 3,
        environment: 'staging',
        executionEnabled: true,
        state: {
          validated: true,
          eligible: true,
          eligibleAmount: 396000,
          minimumAmount: 10000,
          maxTenure: 12,
          offers: [{ tenure: 3, loanAmount: 396000 }],
        },
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      });
    return Response.json({ workflow: { id } });
  });
  render(
    <OxygenProviderFlow
      orderId={id}
      productAmount={396000}
      merchantSlug="shop"
    />
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'See full breakdown' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'See full breakdown' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Oxygen says you already have an active loan'
    )
  );
  expect(
    screen.getByRole('heading', {
      name: 'You already have an active Oxygen loan',
    })
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
    'href',
    '/shop/contact'
  );
  expect(
    screen.queryByRole('button', { name: 'See full breakdown' })
  ).toBeNull();
  expect(
    screen.queryByText(/Oxygen hasn’t confirmed your details/)
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/untrusted private provider detail/)
  ).not.toBeInTheDocument();
  expect(
    mocks.fetch.mock.calls.filter(
      ([url, opts]) => url.endsWith('/actions') && opts?.method === 'POST'
    )
  ).toHaveLength(1);
});
