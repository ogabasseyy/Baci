import { act, renderHook } from '@testing-library/react-native';
import {
  getSavingsFirstCardCapability,
  startSavingsFirstCardCheckout,
} from '@/lib/savings-first-card-checkout';
import {
  readSavingsFirstCardCheckoutSnapshot,
  saveSavingsFirstCardCheckoutSnapshot,
} from '@/lib/savings-first-card-checkout-snapshot';
import { useSavingsFirstCardCheckout } from './use-savings-first-card-checkout';

jest.mock('@/lib/savings-first-card-checkout', () => ({
  getSavingsFirstCardCapability: jest.fn(),
  startSavingsFirstCardCheckout: jest.fn(),
}));
jest.mock('@/lib/savings-first-card-checkout-snapshot', () => ({
  readSavingsFirstCardCheckoutSnapshot: jest.fn(),
  saveSavingsFirstCardCheckoutSnapshot: jest.fn(),
}));

const input = {
  amount: '0.10',
  goalId: 'goal-a',
  merchantId: 'merchant-a',
  userId: 'user-a',
  onAmountChange: jest.fn(),
  remainingAmount: 0.3 - 0.2,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readSavingsFirstCardCheckoutSnapshot).mockResolvedValue(null);
  jest.mocked(getSavingsFirstCardCapability).mockResolvedValue({
    goalId: input.goalId,
    enabled: true,
    maximumAmountKobo: 500000,
    currency: 'NGN',
  });
  jest.mocked(saveSavingsFirstCardCheckoutSnapshot).mockResolvedValue({
    goalId: input.goalId,
    amountKobo: 10,
    idempotencyKey: 'key',
    intentId: null,
    consent: {
      version: 'prefunded-first-card-v1',
      oneTimeCharge: true,
      saveCard: true,
    },
  });
  jest
    .mocked(startSavingsFirstCardCheckout)
    .mockRejectedValue(new Error('synthetic outage'));
});

it('permits ten kobo when remaining naira is 0.30 minus 0.20', async () => {
  const { result } = renderHook(() => useSavingsFirstCardCheckout(input));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.canStart).toBe(true);
  expect(result.current.limitKobo).toBe(10);
  await act(async () => {
    await result.current.begin();
  });
  expect(startSavingsFirstCardCheckout).toHaveBeenCalledWith(
    expect.objectContaining({
      request: expect.objectContaining({ amountKobo: 10 }),
    })
  );
});

it.each([
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  Number.MAX_VALUE,
])('blocks new checkout for invalid remaining amount %s', async (remainingAmount) => {
  const { result } = renderHook(() =>
    useSavingsFirstCardCheckout({ ...input, remainingAmount })
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.canStart).toBe(false);
  expect(result.current.limitKobo).toBe(0);
  await act(async () => {
    await result.current.begin();
  });
  expect(saveSavingsFirstCardCheckoutSnapshot).not.toHaveBeenCalled();
  expect(startSavingsFirstCardCheckout).not.toHaveBeenCalled();
});
