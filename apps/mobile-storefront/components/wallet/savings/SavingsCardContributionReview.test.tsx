import { jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import { SavingsCardContributionReview } from './SavingsCardContributionReview';

type Props = ComponentProps<typeof SavingsCardContributionReview>;
function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    selectedMethod: { id: 'method-1', brand: 'Visa', last4: '4242' },
    amountKobo: 25050,
    amountLabel: '₦250.50',
    snapshot: null,
    reviewing: false,
    canStart: true,
    invalidAmount: false,
    busy: false,
    colors: Colors.light,
    onReview: jest.fn<() => void>(),
    onConfirm: jest.fn<() => void>(),
    onCancelReview: jest.fn<() => void>(),
    ...overrides,
  };
  render(<SavingsCardContributionReview {...props} />);
  return props;
}

it('requests review without confirming a charge', () => {
  const props = setup();
  fireEvent.press(
    screen.getByRole('button', { name: 'Review card contribution' })
  );
  expect(props.onReview).toHaveBeenCalledTimes(1);
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: /Confirm one-time charge/ })
  ).toBeNull();
});

it('shows the exact one-time amount and card and preserves confirm and cancel actions', () => {
  const props = setup({ reviewing: true });
  expect(
    screen.getByText(/one-time charge of ₦250.50 to Visa ending in 4242/)
  ).toBeOnTheScreen();
  expect(
    screen.getByText(/will not change your savings schedule/)
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Review card contribution' })
  ).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm one-time charge ₦250.50' })
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Cancel card contribution review' })
  );
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(props.onCancelReview).toHaveBeenCalledTimes(1);
});

it.each([
  { canStart: false },
  { invalidAmount: true },
])('blocks review when the request cannot start: %j', (overrides) => {
  const props = setup(overrides);
  const button = screen.getByRole('button', {
    name: 'Review card contribution',
  });
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(props.onReview).not.toHaveBeenCalled();
});

it('blocks confirmation while busy but keeps cancellation available', () => {
  const props = setup({ reviewing: true, busy: true });
  const button = screen.getByRole('button', {
    name: 'Confirm one-time charge ₦250.50',
  });
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(props.onConfirm).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByRole('button', { name: 'Cancel card contribution review' })
  );
  expect(props.onCancelReview).toHaveBeenCalledTimes(1);
});

it.each([
  { selectedMethod: undefined },
  { amountKobo: null },
  { amountKobo: 0 },
])('requires a selected card and parsed amount before review: %j', (overrides) => {
  setup(overrides);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

it('does not offer a new review after a durable request is saved', () => {
  setup({
    snapshot: {
      goalId: 'goal-1',
      savedMethodId: 'method-1',
      amountKobo: 25050,
      idempotencyKey: 'key-1',
      consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
    },
  });
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});
