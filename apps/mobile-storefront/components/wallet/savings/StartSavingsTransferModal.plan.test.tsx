import { describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsTransferModal } from './StartSavingsTransferModal';
import type { StartSavingsController } from './start-savings-controller.types';

const mockIsHostedStagingTestPaymentsEnabled = jest.fn(() => false);
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () =>
    mockIsHostedStagingTestPaymentsEnabled(),
}));

function createController(
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

describe('plan funding mode', () => {
  function createPlanController(
    overrides: Partial<StartSavingsController> = {}
  ): StartSavingsController {
    return createController({
      confirmPlanTransfer: jest.fn(async () => undefined),
      createdGoalId: 'goal-1',
      fetchExistingPlanFunding: jest.fn(async () => undefined),
      fetchPlanFunding: jest.fn(async () => undefined),
      fundingAccount: null,
      planFundingAccounts: [],
      planFundingError: null,
      planFundingPhase: 'idle',
      planFundingStatusCode: null,
      submitBankTransferContribution: jest.fn(async () => undefined),
      ...overrides,
    });
  }

  it('shows the persisted initial contribution, not the wallet shortfall', () => {
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={createPlanController({
          contributionValue: 20000,
          effectiveInitialContribution: 70000,
          requiredTopUpAmount: 50000,
        })}
      />
    );

    // A ₦70,000 initial contribution with a ₦20,000 wallet balance must
    // read ₦70,000: the transfer bypasses the wallet, so the ₦50,000
    // shortfall and the ₦20,000 recurring amount are both wrong here.
    expect(screen.getByText('₦70,000')).toBeOnTheScreen();
    expect(screen.queryByText('₦50,000')).not.toBeOnTheScreen();
    expect(screen.queryByText('₦20,000')).not.toBeOnTheScreen();
  });

  it('prompts for BVN and fetches the plan account', async () => {
    const controller = createPlanController();
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    expect(screen.getByText('Fund your plan to continue')).toBeOnTheScreen();
    expect(screen.queryByText('Fund wallet to continue')).not.toBeOnTheScreen();
    fireEvent.changeText(
      screen.getByLabelText('BVN for plan account'),
      '00000000000'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));

    await waitFor(() =>
      expect(controller.fetchPlanFunding).toHaveBeenCalledWith('00000000000', {
        enableInterestAccrual: false,
      })
    );
  });

  it('passes the interest opt-in when fetching the plan account', async () => {
    const controller = createPlanController();
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.changeText(
      screen.getByLabelText('BVN for plan account'),
      '00000000000'
    );
    fireEvent.press(
      screen.getByRole('checkbox', { name: 'Earn interest on this plan' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));

    await waitFor(() =>
      expect(controller.fetchPlanFunding).toHaveBeenCalledWith('00000000000', {
        enableInterestAccrual: true,
      })
    );
  });

  it('hides the BVN prompt in hosted staging and checks status instead', async () => {
    mockIsHostedStagingTestPaymentsEnabled.mockReturnValueOnce(true);
    const controller = createPlanController();
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    // Staging boundary: no real-BVN collection; operators complete the
    // identity check with synthetic identities.
    expect(
      screen.queryByLabelText('BVN for plan account')
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('checkbox', { name: 'Earn interest on this plan' })
    ).not.toBeOnTheScreen();
    expect(
      screen.getByText(
        'This plan needs an identity check that approved operators complete in the test environment. Ask an operator to continue, then check the account status again.'
      )
    ).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole('button', { name: 'Check account status' })
    );

    await waitFor(() =>
      expect(controller.fetchExistingPlanFunding).toHaveBeenCalledTimes(1)
    );
    expect(controller.fetchPlanFunding).not.toHaveBeenCalled();
  });

  it('shows the plan account and confirms the transfer', async () => {
    const controller = createPlanController({
      planFundingAccounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
      planFundingPhase: 'ready',
    });
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    expect(screen.getByText('0001234567')).toBeOnTheScreen();
    expect(screen.getByText('Synthetic bank')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm plan transfer' })
    );

    await waitFor(() =>
      expect(controller.confirmPlanTransfer).toHaveBeenCalledTimes(1)
    );
  });
});
