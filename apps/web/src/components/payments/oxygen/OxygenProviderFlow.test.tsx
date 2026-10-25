import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

it('resumes a saved workflow and stops after prerequisites without offering activation', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
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
              bookingReference: '70000000-0000-4000-8000-000000000001',
              paymentComplete: true,
              setupComplete: true,
            },
            approvalOtpReady: false,
            activationEnabled: false,
            settlementEnabled: false,
          })
        : Response.json({ workflow: { id } })
  );
  render(<OxygenProviderFlow orderId={id} />);
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Payment confirmed' })
    ).toBeVisible()
  );
  expect(screen.queryByRole('button', { name: /activate/i })).toBeNull();
  await waitFor(() => {
    expect(mocks.capture).toHaveBeenCalledWith(
      'oxygen_application_stage_reached',
      {
        order_id: id,
        provider: 'oxygen',
        stage: 'ready_for_activation',
      }
    );
  });

  expect(
    mocks.fetch.mock.calls.every(
      ([, opts]) =>
        opts?.method !== 'POST' || !String(opts?.body).includes('activate')
    )
  ).toBe(true);
});

it('ignores a late draft response from an order that the user has left', async () => {
  const first = '60000000-0000-4000-8000-000000000001';
  const second = '60000000-0000-4000-8000-000000000002';
  let resolveFirst: (value: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.startsWith('/api/payments/oxygen/draft?'))
      return Response.json({ draft: null, version: 0 });
    if (!url.includes('?'))
      return String(opts?.body).includes(first)
        ? pending
        : Response.json({ workflow: { id: second } });
    const id = url.includes(first) ? first : second;
    return Response.json({
      workflowId: id,
      stage: id === first ? 'ready_for_activation' : 'application_required',
      version: 0,
      environment: 'staging',
      executionEnabled: true,
      state: {},
      approvalOtpReady: false,
      checkoutPhone: id === first ? '08000000001' : '08000000002',
      activationEnabled: false,
      settlementEnabled: false,
    });
  });
  const view = render(<OxygenProviderFlow orderId={first} />);
  view.rerender(<OxygenProviderFlow orderId={second} />);
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Verify your identity' })
    ).toBeVisible()
  );
  resolveFirst(Response.json({ workflow: { id: first } }));
  await waitFor(() =>
    expect(
      mocks.fetch.mock.calls.some(([url]) =>
        String(url).includes(`workflowId=${first}`)
      )
    ).toBe(true)
  );
  expect(
    screen.getByRole('heading', { name: 'Verify your identity' })
  ).toBeVisible();
  expect(
    screen.queryByText('Upfront steps complete. Activation is not enabled.')
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: /Check for updates|Refresh saved status/,
    })
  ).toBeNull();
});

it.each([
  401, 403,
])('offers sign-in only for an unauthenticated handoff (%s)', async (status) => {
  mocks.fetch.mockImplementation(async () =>
    Response.json({ error: 'Unavailable' }, { status })
  );
  render(
    <OxygenProviderFlow
      merchantSlug="shop"
      orderId="60000000-0000-4000-8000-000000000001"
    />
  );
  if (status === 401)
    await screen.findByRole('form', { name: 'Sign in to continue' });
  else await screen.findByRole('alert');
  if (status === 401)
    expect(
      screen.getByRole('form', { name: 'Sign in to continue' })
    ).toBeVisible();
  else
    expect(
      screen.queryByRole('form', { name: 'Sign in to continue' })
    ).toBeNull();
});

it('passes the saved profile into the customer form while keeping identity fields empty', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string) =>
    url.startsWith('/api/payments/oxygen/draft?')
      ? Response.json({ draft: null, version: 0 })
      : url.includes('?')
        ? Response.json({
            workflowId: id,
            stage: 'application_required',
            version: 0,
            environment: 'staging',
            executionEnabled: true,
            state: {},
            approvalOtpReady: false,
            checkoutPhone: '08000000001',
            activationEnabled: false,
            settlementEnabled: false,
          })
        : Response.json({ workflow: { id } })
  );
  render(
    <OxygenProviderFlow
      orderId={id}
      prefill={{ first_name: 'Ada', email: 'ada@example.com' }}
    />
  );
  await waitFor(() =>
    expect(screen.getByLabelText('First name')).toHaveValue('Ada')
  );
  expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  expect(screen.getByLabelText('BVN')).toHaveValue('');
  expect(screen.getByRole('checkbox', { hidden: true })).not.toBeChecked();
});

it('shows a neutral skeleton while opening without customer-facing staging diagnostics', () => {
  mocks.fetch.mockReturnValue(new Promise<Response>(() => {}));
  render(
    <OxygenProviderFlow
      merchantSlug="shop"
      orderId="60000000-0000-4000-8000-000000000001"
    />
  );
  expect(
    screen.getByRole('status', { name: 'Preparing your application' })
  ).toBeVisible();
  expect(
    screen.queryByText(/Staging checkout|Loading saved status/)
  ).toBeNull();
  expect(screen.queryByRole('button', { name: /activate|settle/i })).toBeNull();
});

it('keeps unrelated status actions out of the phone verification step', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string) =>
    url.includes('?')
      ? Response.json({
          workflowId: id,
          stage: 'eligibility_required',
          version: 1,
          environment: 'staging',
          executionEnabled: true,
          state: { applicationReference: id },
          approvalOtpReady: false,
          activationEnabled: false,
          settlementEnabled: false,
        })
      : Response.json({ workflow: { id } })
  );
  render(<OxygenProviderFlow orderId={id} />);
  await screen.findByRole('form', { name: 'Verify phone' });
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Check verification status' })
  ).toBeNull();
});

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
  const id = '60000000-0000-4000-8000-000000000001';
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
    expect(screen.queryByRole('button', { name: 'Sending…' })).toBeNull()
  );
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
        state: { validated: true, eligible: true, maxTenure: 12 },
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      });
    return Response.json({ workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} productAmount={396000} />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Review payment plan' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review payment plan' }));
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
      state: { validated: true, eligible: true, maxTenure: 12 },
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
    await screen.findByRole('button', { name: 'Review payment plan' })
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
    screen.queryByRole('button', { name: /Try again|Review payment plan/ })
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
  fireEvent.change(await screen.findByLabelText('Verification code'), {
    target: { value: '123456' },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
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
        state: { validated: true, eligible: true, maxTenure: 12 },
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
      screen.getByRole('button', { name: 'Review payment plan' })
    ).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review payment plan' }));
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
    screen.queryByRole('button', { name: 'Review payment plan' })
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
