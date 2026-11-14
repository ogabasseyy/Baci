import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { ManualPrimaryGoalSection } from './ManualPrimaryGoalSection';
import { resetGoalSetupMemory } from './savings/goal-setup-memory';

// Only the network read is mocked: the sheet's real status hook, poll and
// status note run, so its Try again button is exercised end to end.
jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
  setupExistingSavingsGoal: jest.fn(),
  retrySavingsGoalSetup: jest.fn(),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));
jest.mock('./WalletSavingsContributionFlow', () => ({
  WalletSavingsContributionFlow: () => {
    const { Text } = require('react-native');
    return <Text>contribution-actions</Text>;
  },
}));

const read = jest.mocked(fetchExistingSavingsPlanFunding);
const ERROR_COPY = /couldn’t check on your plan just now/;
const goal: WalletActiveSavingsGoal = {
  contribution_amount: 1000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-a',
  maturity_date: '2026-12-01',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'Phone',
};

function renderSheet() {
  render(
    <ManualPrimaryGoalSection
      addAmount="1000"
      colors={Colors.light}
      goal={goal}
      isAdding={false}
      isFundPending={false}
      merchantId="merchant-a"
      onAddAmountChange={jest.fn()}
      onAddSavings={jest.fn()}
      onFundWallet={jest.fn()}
      remainingAmount={250000}
      usesPlanFunding={false}
      userId="customer-a"
      visible
      walletBalance={0}
    />
  );
}

beforeEach(() => {
  resetGoalSetupMemory();
  read.mockReset();
});

describe('bugfix: Try again after a failed plan status read did nothing', () => {
  it('reads the status again on every tap, then recovers once the read works', async () => {
    // Arrange: the first read fails (the web app was restarting).
    read.mockRejectedValue(new Error('Network request failed'));
    renderSheet();
    await act(async () => {});
    expect(screen.getByText(ERROR_COPY)).toBeOnTheScreen();
    expect(read).toHaveBeenCalledTimes(1);

    // Act: Try again while the server is still down, then once it is back.
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByText(ERROR_COPY)).toBeOnTheScreen();
    read.mockResolvedValue({ status: 'ready' });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });

    // Assert: each tap sent a fresh read, and the recovered read clears it.
    expect(read).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(ERROR_COPY)).toBeNull();
    expect(screen.getByText('contribution-actions')).toBeOnTheScreen();
  });

  it('shows Checking… while the new read runs, and stays on the error if it fails again', async () => {
    read.mockRejectedValue(new Error('Network request failed'));
    renderSheet();
    await act(async () => {});
    let failAgain: (error: Error) => void = () => undefined;
    read.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failAgain = reject;
        })
    );

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(screen.getByRole('button', { name: 'Checking' })).toBeDisabled();

    await act(async () => failAgain(new Error('Network request failed')));
    expect(screen.getByText(ERROR_COPY)).toBeOnTheScreen();
    expect(screen.getByText(/^Last tried \d{2}:\d{2}$/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
