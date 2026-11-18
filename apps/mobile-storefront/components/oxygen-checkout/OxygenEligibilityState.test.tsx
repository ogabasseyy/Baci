import { fireEvent, render, screen } from '@testing-library/react-native';
import { OxygenEligibilityState } from './OxygenEligibilityState';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

it('explains a financial-details mismatch and lets the customer retry deliberately', () => {
  const retry = jest.fn();
  render(
    <OxygenEligibilityState
      status="failed"
      failureReason="financial_details_mismatch"
      delayed={false}
      disabled={false}
      hasError={false}
      onRetry={retry}
      onViewOrders={jest.fn()}
    />
  );
  expect(screen.getByText(/contact your bank/i)).toBeTruthy();
  expect(screen.queryByText('Checking your payment options')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('shows saved progress instead of an endless spinner when Oxygen is taking longer', () => {
  render(
    <OxygenEligibilityState
      status="pending"
      delayed
      disabled={false}
      hasError={false}
      onRetry={jest.fn()}
      onViewOrders={jest.fn()}
    />
  );
  expect(screen.getByText(/taking longer/i)).toBeTruthy();
  expect(screen.queryByText('Checking your payment options')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Check for an update' })
  ).toBeTruthy();
});

it('explains a completed ineligible decision instead of showing a blank screen', () => {
  const viewOrders = jest.fn();
  render(
    <OxygenEligibilityState
      status="completed"
      eligible={false}
      delayed={false}
      disabled={false}
      hasError={false}
      onRetry={jest.fn()}
      onViewOrders={viewOrders}
    />
  );
  expect(screen.getByText(/couldn’t offer a payment plan/i)).toBeTruthy();
  expect(screen.getByText(/another payment method/i)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'View my orders' }));
  expect(viewOrders).toHaveBeenCalledTimes(1);
});

it('shows the provider-reported stage and lets the customer check for an update', () => {
  const check = jest.fn();
  render(
    <OxygenEligibilityState
      status="pending"
      progress="credit_score"
      delayed
      disabled={false}
      hasError={false}
      onRetry={check}
      onViewOrders={jest.fn()}
    />
  );
  expect(screen.getByText('Oxygen is checking your credit score')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Check for an update' }));
  expect(check).toHaveBeenCalledTimes(1);
});
