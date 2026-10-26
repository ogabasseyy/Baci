import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsContributionSection } from './WalletSavingsContributionSection';

jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => null,
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
  isHostedStagingWalletTopUpBlocked: () => true,
}));
const props = {
  goal: {
    id: 'goal-a',
    status: 'active' as const,
    source_mode: 'manual' as const,
    title: 'Phone',
    current_amount: 0,
    target_amount: 1000,
    contribution_amount: 100,
    contribution_frequency: 'weekly' as const,
    maturity_date: '2026-12-01',
  },
  addAmount: '100',
  colors: Colors.dark,
  isAdding: false,
  isFundPending: false,
  onAddAmountChange: jest.fn(),
  onAddSavings: jest.fn(),
  onFundWallet: jest.fn(),
  remainingAmount: 1000,
  walletBalance: 0,
  hasPendingContribution: false,
  canAdd: true,
  usesPlanFunding: false,
  usesWalletBankTransfer: true,
  visible: true,
};

it('passes primary wallet funding through without the hosted card restriction', () => {
  render(<WalletSavingsContributionSection {...props} />);
  expect(
    screen.getByRole('button', { name: 'Open wallet bank transfer details' })
  ).toBeEnabled();
});

it('keeps pending contributions in recovery rather than starting another transfer', () => {
  render(
    <WalletSavingsContributionSection {...props} hasPendingContribution />
  );
  expect(
    screen.queryByRole('button', { name: 'Open wallet bank transfer details' })
  ).toBeNull();
});

it('does not offer another contribution to a completed goal', () => {
  render(
    <WalletSavingsContributionSection
      {...props}
      canAdd={false}
      goal={{ ...props.goal, status: 'completed' }}
    />
  );
  expect(screen.getByText('This savings goal is complete.')).toBeOnTheScreen();
});
