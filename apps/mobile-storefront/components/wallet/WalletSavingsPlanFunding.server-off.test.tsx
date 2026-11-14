import { act, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import { expectNoPiggyvestUi } from '@/test-support/piggyvest-server-off.test-support';
import { WalletSavingsPlanFunding } from './WalletSavingsPlanFunding';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/savings-card-contributions', () => ({
  getSavingsCardContributionOptions: jest
    .fn()
    .mockRejectedValue(new Error('Unavailable')),
  getSavingsCardContributionStatus: jest.fn(),
  submitSavingsCardContribution: jest.fn(),
}));
jest.mock('@/lib/savings-card-contribution-snapshot', () => ({
  clearTerminalSavingsCardContributionSnapshot: jest.fn(),
  readSavingsCardContributionSnapshot: jest.fn().mockResolvedValue(null),
  saveSavingsCardContributionSnapshot: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));

const goal: WalletActiveSavingsGoal = {
  id: 'goal-1',
  title: 'Phone',
  contribution_amount: 500,
  contribution_frequency: 'weekly',
  current_amount: 100,
  target_amount: 250000,
  maturity_date: '2026-11-01',
  source_mode: 'manual',
  status: 'active',
};

// A merchant without a server verdict shows the wallet guidance only and
// never reads the primary plan status.
describe('server keeps PiggyVest off', () => {
  it('shows wallet guidance, no status note and no status request', async () => {
    render(
      <WalletSavingsPlanFunding
        addAmount=""
        colors={Colors.dark}
        goal={goal}
        onAddAmountChange={jest.fn()}
      />
    );
    await act(async () => {});
    expect(screen.getByText('Add from your wallet')).toBeOnTheScreen();
    expectNoPiggyvestUi();
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
    expect(fetchSavingsPlanFunding).not.toHaveBeenCalled();
  });
});
