import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanCardContributionView } from './SavingsPlanCardContributionView';

it('keeps card contributions unavailable when no server capability is loaded', () => {
  render(
    <SavingsPlanCardContributionView
      amount=""
      amountKobo={null}
      amountLabel="₦0.00"
      allowRetry={false}
      busy={false}
      canStart={false}
      canStartNew={false}
      capabilityLoaded={false}
      colors={Colors.light}
      enabled={false}
      expanded
      invalidAmount={false}
      loading={false}
      message=""
      methods={[]}
      onAmountChange={jest.fn()}
      onCancelReview={jest.fn()}
      onCheckStatus={jest.fn()}
      onConfirm={jest.fn()}
      onRetry={jest.fn()}
      onReview={jest.fn()}
      onSelectMethod={jest.fn()}
      onToggle={jest.fn()}
      onNewContribution={jest.fn()}
      operationStatus={null}
      reviewing={false}
      selectedMethod={undefined}
      selectedMethodId=""
      snapshot={null}
      sourceMode="manual"
    />
  );

  expect(
    screen.getByText('Card contributions are unavailable right now.')
  ).toBeOnTheScreen();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /confirm one-time charge/i })
  ).toBeNull();
});
