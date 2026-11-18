import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenPaymentStep } from './OxygenPaymentStep';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

it('shows the confirmed upfront amount before opening Oxygen', () => {
  const onContinue = jest.fn();
  render(
    <OxygenPaymentStep
      state="ready"
      upfrontAmount={52432.88}
      onContinue={onContinue}
      onRefresh={jest.fn()}
    />
  );
  expect(screen.getByText('Pay your upfront amount')).toBeTruthy();
  expect(screen.getByText(/52,432\.88/)).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Check payment status' })
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Check for an update' })
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Continue payment' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

it('explains the next step after payment without showing the amount again', () => {
  render(
    <OxygenPaymentStep
      state="ready"
      paymentComplete
      upfrontAmount={52432.88}
      onContinue={jest.fn()}
      onRefresh={jest.fn()}
    />
  );
  expect(screen.getByText('Set up your repayments')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Complete repayment setup' })
  ).toBeTruthy();
  expect(screen.queryByText(/52,432\.88/)).toBeNull();
});

it('shows status recovery when the hosted action is unavailable', () => {
  const onRefresh = jest.fn();
  render(
    <OxygenPaymentStep
      state="unavailable"
      paymentComplete
      onContinue={jest.fn()}
      onRefresh={onRefresh}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Complete repayment setup' })
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Check payment status' }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
