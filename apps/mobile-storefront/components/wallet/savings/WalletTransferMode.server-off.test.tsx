import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { StartSavingsController } from './start-savings-controller.types';
import { WalletTransferMode } from './WalletTransferMode';

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
}));

function controller(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    contributionValue: 20000,
    fundingAccount: {
      account_number: '0123456789',
      bank_name: 'Titan Paystack',
      provider: 'paystack',
    },
    handleCopyFundingAccount: jest.fn(async () => undefined),
    isSubmitting: false,
    openWalletFundingScreen: jest.fn(),
    requiredTopUpAmount: 50000,
    showTransferModal: true,
    submitSavingsGoal: jest.fn(async () => undefined),
    ...overrides,
  } as StartSavingsController;
}

// With the server keeping PiggyVest off the start-savings transfer step is
// today's legacy one: the legacy account, the amount and the funding screen.
describe('WalletTransferMode with the server off', () => {
  it('shows the legacy account and the larger of top-up and contribution', () => {
    render(
      <WalletTransferMode colors={Colors.light} controller={controller()} />
    );
    expect(screen.getByText('Add money to continue')).toBeOnTheScreen();
    expect(screen.getByText('₦50,000')).toBeOnTheScreen();
    expect(screen.getByText('0123456789')).toBeOnTheScreen();
  });

  it('asks for an account number from the funding screen when there is none', () => {
    render(
      <WalletTransferMode
        colors={Colors.light}
        controller={controller({ fundingAccount: null })}
      />
    );
    expect(screen.getByText(/Create your account number/)).toBeOnTheScreen();
  });
});
