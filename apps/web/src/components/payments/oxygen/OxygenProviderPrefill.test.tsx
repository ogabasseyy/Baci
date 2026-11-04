import { render, screen, waitFor } from '@testing-library/react';
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
  expect(
    screen.getByRole('checkbox', { name: /I agree to share/, hidden: true })
  ).not.toBeChecked();
});
