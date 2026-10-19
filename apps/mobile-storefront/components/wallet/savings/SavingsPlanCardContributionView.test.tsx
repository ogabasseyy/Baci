import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanCardContributionView } from './SavingsPlanCardContributionView';

it('requires an explicit one-time confirmation and has no add-card action', () => {
  render(
    <SavingsPlanCardContributionView
      amount="250.50"
      amountKobo={25050}
      amountLabel="₦250.50"
      allowRetry={false}
      busy={false}
      canStart
      canStartNew={false}
      capabilityLoaded
      colors={Colors.light}
      enabled
      expanded
      invalidAmount={false}
      loading={false}
      message=""
      methods={[{ id: 'method-1', brand: 'Visa', last4: '4242' }]}
      onAmountChange={jest.fn()}
      onCancelReview={jest.fn()}
      onCheckStatus={jest.fn()}
      onConfirm={jest.fn()}
      onRetry={jest.fn()}
      onReview={jest.fn()}
      onNewContribution={jest.fn()}
      onSelectMethod={jest.fn()}
      onToggle={jest.fn()}
      operationStatus={null}
      reviewing
      selectedMethod={{ id: 'method-1', brand: 'Visa', last4: '4242' }}
      selectedMethodId="method-1"
      snapshot={null}
      sourceMode="manual"
    />
  );
  expect(screen.getByText(/one-time charge of ₦250.50/)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Confirm one-time charge ₦250.50' })
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add a card' })).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Cancel card contribution review' })
  );
});
