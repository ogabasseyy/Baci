import { act, fireEvent, render, screen } from '@testing-library/react';
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

it('refreshes older applications that have no saved per-period offers', async () => {
  mocks.fetch.mockClear();
  const id = '60000000-0000-4000-8000-000000000001';
  const snapshot = {
    workflowId: id,
    stage: 'plan_required',
    version: 3,
    environment: 'staging',
    executionEnabled: true,
    state: {
      validated: true,
      eligible: true,
      eligibleAmount: 189000,
      minimumAmount: 68000,
      maxTenure: 3,
    },
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
  };
  mocks.fetch.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/actions') && opts?.method === 'POST') {
      return Response.json({
        ...snapshot,
        version: 4,
        state: {
          ...snapshot.state,
          offers: [{ tenure: 3, loanAmount: 189000 }],
        },
      });
    }
    return url.includes('?')
      ? Response.json(snapshot)
      : Response.json({ workflow: { id } });
  });
  render(<OxygenProviderFlow orderId={id} productAmount={198000} />);
  const button = await screen.findByRole('button', {
    name: 'Update payment options',
  });
  expect(
    screen.queryByRole('button', { name: 'See full breakdown' })
  ).not.toBeInTheDocument();
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'See full breakdown' });
  const post = mocks.fetch.mock.calls.find(
    ([url, opts]) => url.endsWith('/actions') && opts?.method === 'POST'
  );
  expect(JSON.parse(post?.[1]?.body as string).command).toEqual({
    action: 'refresh_eligibility',
  });
});
