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
        scheduleIncomplete: true,
      },
    }),
  });
  vi.stubGlobal('fetch', fetcher);
  render(<OxygenOrderPlan orderId="order" currency="NGN" />);
  expect(await screen.findByText('Upfront payment confirmed')).toBeVisible();
  expect(
    screen.getByRole('region', { name: 'Oxygen payment plan' })
  ).toHaveAttribute('id', 'oxygen-payment-plan');
  expect(screen.getByText('27 Nov 2026')).toBeVisible();
  expect(screen.getByText('Instalment 1')).toBeVisible();
  expect(screen.getByText(/Some payment dates are unavailable/)).toBeVisible();
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
          repaymentReceipts: [
            {
              id: 'bb3955b1-0571-49eb-919f-6a6946fdb00b',
              recordedAt: '2026-11-19T23:30:00Z',
            },
          ],
        },
      }),
    })
  );
  render(<OxygenOrderPlan orderId="order" currency="NGN" />);
  expect(await screen.findByText('Payment plan active')).toBeVisible();
  expect(screen.getAllByText('Oxygen reported a repayment')).toHaveLength(1);
  expect(screen.getByText('Recorded 20 Nov 2026')).toBeVisible();
  expect(screen.queryByText(/settlement received/i)).not.toBeInTheDocument();
});
