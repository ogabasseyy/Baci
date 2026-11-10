import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsFirstCardCheckout } from './SavingsFirstCardCheckout';
import type { useSavingsFirstCardCheckout } from './use-savings-first-card-checkout';

const mockBegin = jest.fn();
const mockSetReviewing = jest.fn();
let mockCheckout: ReturnType<typeof useSavingsFirstCardCheckout> = {
  amountKobo: 12500,
  begin: mockBegin,
  busy: false,
  canStart: true,
  enabled: true,
  limitKobo: 50000,
  loading: false,
  message: '',
  recoveryBlocked: false,
  refreshStatus: jest.fn(),
  reviewing: false,
  setReviewing: mockSetReviewing,
  snapshot: null,
  status: null,
  allowRetry: false,
};

jest.mock('./use-savings-first-card-checkout', () => ({
  useSavingsFirstCardCheckout: () => mockCheckout,
}));

const props = {
  colors: Colors.light,
  goalId: '00000000-0000-4000-8000-000000000001',
  merchantId: 'merchant-a',
  remainingAmount: 1000,
  userId: 'user-a',
};

beforeEach(() => {
  mockBegin.mockReset();
  mockSetReviewing.mockReset();
  mockCheckout = {
    amountKobo: 12500,
    begin: mockBegin,
    busy: false,
    canStart: true,
    enabled: true,
    limitKobo: 50000,
    loading: false,
    message: '',
    recoveryBlocked: false,
    refreshStatus: jest.fn(),
    reviewing: false,
    setReviewing: mockSetReviewing,
    snapshot: null,
    status: null,
    allowRetry: false,
  };
});

it('requires consent to the actual one-time amount and card saving without auto-debit', () => {
  render(<SavingsFirstCardCheckout {...props} />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Review new card contribution' })
  );
  expect(mockSetReviewing).toHaveBeenCalledWith(true);
  mockCheckout = { ...mockCheckout, reviewing: true };
  render(<SavingsFirstCardCheckout {...props} />);
  expect(
    screen.getByText(
      /one-time charge of ₦125.00 and save this card for future use/
    )
  ).toBeOnTheScreen();
  expect(
    screen.getByText(/does not enable automatic payments/)
  ).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole('button', {
      name: /Confirm one-time new card charge ₦125.00/,
    })
  );
  expect(mockBegin).toHaveBeenCalledTimes(1);
});

it('hides first-card setup when the separate server capability is unavailable', () => {
  mockCheckout = { ...mockCheckout, enabled: false };
  const view = render(<SavingsFirstCardCheckout {...props} />);
  expect(view.toJSON()).toBeNull();
  expect(screen.queryByRole('button', { name: /new card/i })).toBeNull();
});

it('keeps the review action visible but disabled while the amount is empty', () => {
  mockCheckout = { ...mockCheckout, amountKobo: null, canStart: false };
  render(<SavingsFirstCardCheckout {...props} />);

  const review = screen.getByRole('button', {
    name: 'Review new card contribution',
  });
  expect(review).toBeDisabled();
  fireEvent.press(review);
  expect(mockSetReviewing).not.toHaveBeenCalled();
  expect(mockBegin).not.toHaveBeenCalled();
});

it('shows the server limit and enables review only after a valid amount', () => {
  mockCheckout = {
    ...mockCheckout,
    amountKobo: null,
    canStart: false,
    limitKobo: 10000,
  };
  const view = render(
    <SavingsFirstCardCheckout {...props} colors={Colors.dark} />
  );
  expect(screen.getByText('Up to ₦100.00 per contribution')).toBeOnTheScreen();
  fireEvent.changeText(
    screen.getByLabelText('New card contribution amount'),
    '100'
  );
  mockCheckout = { ...mockCheckout, amountKobo: 10000, canStart: true };
  view.rerender(<SavingsFirstCardCheckout {...props} colors={Colors.dark} />);

  const review = screen.getByRole('button', {
    name: 'Review new card contribution',
  });
  expect(review).toBeEnabled();
  fireEvent.press(review);
  expect(mockSetReviewing).toHaveBeenCalledWith(true);
  expect(mockBegin).not.toHaveBeenCalled();
});

it('keeps review visible and disabled for an amount above the checkout limit', () => {
  mockCheckout = {
    ...mockCheckout,
    amountKobo: 10100,
    canStart: false,
    limitKobo: 10000,
  };
  render(<SavingsFirstCardCheckout {...props} />);
  fireEvent.changeText(
    screen.getByLabelText('New card contribution amount'),
    '101'
  );

  const review = screen.getByRole('button', {
    name: 'Review new card contribution',
  });
  expect(review).toBeDisabled();
  expect(screen.getByText(/Enter an amount within/)).toBeOnTheScreen();
  fireEvent.press(review);
  expect(mockSetReviewing).not.toHaveBeenCalled();
  expect(mockBegin).not.toHaveBeenCalled();
});

it('keeps saved checkout recovery visible when new starts are disabled', () => {
  mockCheckout = {
    ...mockCheckout,
    enabled: false,
    canStart: false,
    snapshot: {
      goalId: props.goalId,
      amountKobo: 12500,
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
      consent: {
        version: 'prefunded-first-card-v1',
        oneTimeCharge: true,
        saveCard: true,
      },
      intentId: '00000000-0000-4000-8000-000000000003',
      status: 'pending',
    },
    status: 'pending',
  };
  render(<SavingsFirstCardCheckout {...props} />);
  expect(
    screen.getByRole('button', { name: 'Check new card checkout status' })
  ).toBeOnTheScreen();
});
