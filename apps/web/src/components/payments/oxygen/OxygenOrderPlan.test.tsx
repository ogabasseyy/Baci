import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OxygenOrderPlan } from './OxygenOrderPlan';

afterEach(() => vi.unstubAllGlobals());
it('shows saved payment dates without inventing monthly paid statuses', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      plan: {
        upfront: 52432.88,
        upfrontConfirmed: true,
        months: 3,
        schedule: [{ period: 1, dueDate: [2026, 11, 27], amount: 55658 }],
      },
    }),
  });
  vi.stubGlobal('fetch', fetcher);
  render(<OxygenOrderPlan orderId="order" currency="NGN" />);
  expect(await screen.findByText('Upfront payment confirmed')).toBeVisible();
  expect(screen.getByText('27 Nov 2026')).toBeInTheDocument();
  expect(
    screen.getByText(/Monthly repayment status is not available/)
  ).toBeVisible();
  expect(fetcher).toHaveBeenCalledOnce();
});
it('shows a recoverable saved-plan read failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<OxygenOrderPlan orderId="order" currency="NGN" />);
  expect(await screen.findByText(/temporarily unavailable/)).toBeVisible();
});

it('shows confirmed activation separately from merchant settlement', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: {
          upfront: 52432.88,
          upfrontConfirmed: true,
          activationConfirmed: true,
          months: 3,
          schedule: [],
        },
      }),
    })
  );
  render(<OxygenOrderPlan orderId="order" currency="NGN" />);
  expect(await screen.findByText('Payment plan active')).toBeVisible();
  expect(screen.queryByText(/settlement received/i)).not.toBeInTheDocument();
});
