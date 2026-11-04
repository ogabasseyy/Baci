import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

import { OxygenProviderFlow } from './OxygenProviderFlow';

it('restores the active-loan recovery screen after reopening and a fresh page mount', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  mocks.fetch.mockImplementation(async (url: string) =>
    Response.json(
      url.includes('?')
        ? {
            workflowId: id,
            stage: 'plan_required',
            version: 4,
            environment: 'staging',
            executionEnabled: true,
            bookingBlock: 'active_loan',
            state: {
              validated: true,
              eligible: true,
              eligibilityStatus: 'completed',
            },
            approvalOtpReady: false,
            activationEnabled: false,
            settlementEnabled: false,
          }
        : { workflow: { id } }
    )
  );
  const view = render(<OxygenProviderFlow orderId={id} merchantSlug="shop" />);
  const check = async () => {
    expect(
      await screen.findByRole('heading', {
        name: 'You already have an active Oxygen loan',
      })
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Contact support' })
    ).toHaveAttribute('href', '/shop/contact');
    expect(
      screen.queryByRole('button', {
        name: /Review payment plan|activate|settle/i,
      })
    ).toBeNull();
  };
  await check();
  view.rerender(
    <OxygenProviderFlow orderId={id} merchantSlug="shop" active={false} />
  );
  view.rerender(<OxygenProviderFlow orderId={id} merchantSlug="shop" active />);
  await check();
  view.unmount();
  render(<OxygenProviderFlow orderId={id} merchantSlug="shop" />);
  await check();
  expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/actions'))).toBe(
    false
  );
});

it('tells the customer to contact support when an existing payment needs checking', async () => {
  mocks.fetch.mockResolvedValue(
    Response.json({ code: 'OXYGEN_PAYMENT_ORIGIN_UNVERIFIED' }, { status: 409 })
  );
  render(
    <OxygenProviderFlow
      orderId="60000000-0000-4000-8000-000000000001"
      merchantSlug="shop"
    />
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'We need to check your existing payment before continuing. Please contact support with your order number.'
  );
  expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
    'href',
    '/shop/contact'
  );
  expect(
    screen.queryByRole('button', { name: 'Check for an update' })
  ).toBeNull();
});
