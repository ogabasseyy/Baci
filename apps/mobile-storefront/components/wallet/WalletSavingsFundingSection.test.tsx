import { describe, expect, it, jest } from '@jest/globals';
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

function props(sourceMode: string, over = {}) {
  return {
    addAmount: '',
    colors: Colors.dark,
    goal: {
      id: 'g1',
      source_mode: sourceMode,
    } as unknown as WalletActiveSavingsGoal,
    isAdding: false,
    isFundPending: false,
    onAddAmountChange: jest.fn(),
    onAddSavings: jest.fn(),
    onFundWallet: jest.fn(),
    remainingAmount: 1000,
    usesPlanFunding: true,
    visible: true,
    walletBalance: 0,
    ...over,
  };
}

describe('WalletSavingsFundingSection', () => {
  it('shows wallet contribution and plan funding for manual plans', () => {
    render(<WalletSavingsFundingSection {...props('manual')} />);
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.getByText('plan-funding')).toBeOnTheScreen();
  });

  it('shows only plan funding for non-manual plans', () => {
    render(<WalletSavingsFundingSection {...props('piggyvest')} />);
    expect(screen.queryByText('wallet-contribution')).toBeNull();
    expect(screen.getByText('plan-funding')).toBeOnTheScreen();
  });

  it('renders nothing while hidden in plan-funding mode', () => {
    render(
      <WalletSavingsFundingSection {...props('manual', { visible: false })} />
    );
    expect(screen.queryByText('wallet-contribution')).toBeNull();
  });

  it('shows only wallet contribution without plan funding', () => {
    render(
      <WalletSavingsFundingSection
        {...props('manual', { usesPlanFunding: false, visible: false })}
      />
    );
    expect(screen.getByText('wallet-contribution')).toBeOnTheScreen();
    expect(screen.queryByText('plan-funding')).toBeNull();
  });
});
