import { act, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { readOxygenOrderPlan } from '@/lib/oxygen-order-plan';
import { OxygenOrderPlanCard } from './OxygenOrderPlanCard';

jest.mock('@/lib/oxygen-order-plan', () => ({
  readOxygenOrderPlan: jest.fn(),
}));

const readPlan = jest.mocked(readOxygenOrderPlan);
const props = {
  colors: Colors.light,
  orderId: 'order',
  userId: 'customer',
};

beforeEach(() => {
  readPlan.mockReset();
});

it('shows the saved schedule and the upfront payment separately', async () => {
  readPlan.mockResolvedValue({
    upfront: 52432.88,
    upfrontConfirmed: true,
    activationConfirmed: true,
    months: 1,
    schedule: [{ period: 1, dueDate: [2026, 11, 27], amount: 55658 }],
    scheduleIncomplete: true,
    repaymentReceipts: [
      {
        id: 'bb3955b1-0571-49eb-919f-6a6946fdb00b',
        recordedAt: '2026-11-19T23:30:00Z',
      },
    ],
  });
  render(<OxygenOrderPlanCard {...props} />);
  expect(await screen.findByText('Oxygen payment plan')).toBeVisible();
  expect(screen.getByText('Upfront payment confirmed')).toBeVisible();
  expect(screen.getByText('Instalment 1')).toBeVisible();
  expect(screen.getByText('27 Nov 2026')).toBeVisible();
  expect(screen.getByText('₦55,658')).toBeVisible();
  expect(screen.getByText(/Some payment dates are unavailable/)).toBeVisible();
  expect(screen.getAllByText('Oxygen reported a repayment')).toHaveLength(1);
  expect(screen.getByText('Recorded 20 Nov 2026')).toBeVisible();
  expect(readPlan).toHaveBeenCalledWith('order', 'customer', expect.anything());
});

it('clears the old plan when moving to an order without a saved plan', async () => {
  readPlan.mockResolvedValueOnce({
    upfront: null,
    upfrontConfirmed: false,
    activationConfirmed: false,
    months: 1,
    schedule: [{ period: 1, dueDate: [2026, 11, 27], amount: 55658 }],
  });
  readPlan.mockResolvedValueOnce(null);
  const { rerender } = render(<OxygenOrderPlanCard {...props} />);
  expect(await screen.findByText('Oxygen payment plan')).toBeVisible();
  await act(async () => {
    rerender(<OxygenOrderPlanCard {...props} orderId="another-order" />);
  });
  expect(screen.queryByText('27 Nov 2026')).toBeNull();
  expect(screen.queryByText('Oxygen payment plan')).toBeNull();
});

it('explains how to retry a failed plan read without exposing transport errors', async () => {
  readPlan.mockRejectedValueOnce(new Error('Private transport details'));
  render(<OxygenOrderPlanCard {...props} />);
  expect(screen.getByText('Loading payment plan…')).toBeVisible();
  expect(
    await screen.findByText(
      'Your saved payment plan is temporarily unavailable. Reopen this order to try again.'
    )
  ).toBeVisible();
  expect(screen.queryByText('Private transport details')).toBeNull();
});
