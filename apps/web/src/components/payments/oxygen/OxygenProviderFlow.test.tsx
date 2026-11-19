import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';

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
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(async () => {
  cleanup();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllGlobals());

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
