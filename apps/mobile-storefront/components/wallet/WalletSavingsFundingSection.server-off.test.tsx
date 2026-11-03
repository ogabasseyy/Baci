import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';

jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>wallet-contribution</Text>;
  },
}));
jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => {
    const { Text } = require('react-native');
    return <Text>plan-funding</Text>;
  },
}));

const goal = {
  id: 'g1',
  source_mode: 'manual',
} as unknown as WalletActiveSavingsGoal;
const props = {
  addAmount: '',
  colors: Colors.dark,
  goal,
  isAdding: false,
  isFundPending: false,
  onAddAmountChange: jest.fn(),
  onAddSavings: jest.fn(),
  onFundWallet: jest.fn(),
  remainingAmount: 1000,
  walletBalance: 0,
};

// Without plan funding the section is today's wallet contribution alone.
describe('server keeps PiggyVest off', () => {
  it.each([
    true,
    false,
  ])('mounts only the wallet contribution (visible %s)', (visible) => {
    render(
      <WalletSavingsFundingSection
        {...props}
        usesPlanFunding={false}
        visible={visible}
      />
    );
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });

  it('keeps the wallet contribution for an auto-debit goal too', () => {
    render(
      <WalletSavingsFundingSection
        {...props}
        goal={{ id: 'g2', source_mode: 'auto_debit' } as never}
        usesPlanFunding={false}
        visible
      />
    );
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });
});
