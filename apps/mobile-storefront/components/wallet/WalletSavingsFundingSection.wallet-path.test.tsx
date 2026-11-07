import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { WalletSavingsFundingSection } from './WalletSavingsFundingSection';

// The real contribution flow is rendered: it reads the hosted-staging
// plan-funding switch itself (it takes no usesPlanFunding prop), so the
// section must land on the wallet-funding path, never the card path.
jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => null,
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => true,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

describe('WalletSavingsFundingSection wallet path', () => {
  it('shows the wallet-funding action, not the card payment action', () => {
    const onFundWallet = jest.fn();
    render(
      <WalletSavingsFundingSection
        addAmount="500"
        colors={Colors.dark}
        goal={
          {
            id: 'g1',
            source_mode: 'manual',
          } as unknown as WalletActiveSavingsGoal
        }
        isAdding={false}
        isFundPending={false}
        onAddAmountChange={jest.fn()}
        onAddSavings={jest.fn()}
        onFundWallet={onFundWallet}
        remainingAmount={1000}
        usesPlanFunding
        visible
        walletBalance={0}
      />
    );
    const action = screen.getByRole('button', {
      name: 'Add money for savings',
    });
    expect(
      screen.queryByRole('button', { name: 'Continue to payment' })
    ).toBeNull();
    fireEvent.press(action);
    expect(onFundWallet).toHaveBeenCalledTimes(1);
  });
});
