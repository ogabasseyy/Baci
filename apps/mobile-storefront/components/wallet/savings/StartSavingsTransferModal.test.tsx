import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
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

describe('StartSavingsTransferModal', () => {
  it('shows transfer amount and funding account details', () => {
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={createController()}
      />
    );

    expect(screen.getByText('Fund wallet to continue')).toBeOnTheScreen();
    expect(screen.getByText('₦50,000')).toBeOnTheScreen();
    expect(screen.getByText('0123456789')).toBeOnTheScreen();
    expect(screen.getByText('Titan Paystack')).toBeOnTheScreen();
  });

  it('wires copy, retry, and wallet funding actions', async () => {
    const controller = createController();
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Copy savings funding account number',
      })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry savings creation' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Open wallet funding screen' })
    );

    expect(controller.handleCopyFundingAccount).toHaveBeenCalledTimes(1);
    expect(controller.submitSavingsGoal).toHaveBeenCalledTimes(1);
    expect(controller.openWalletFundingScreen).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByText('Copy account')).toBeOnTheScreen()
    );
  });

  it('logs rejected copy and retry actions instead of leaving unhandled promises', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const controller = createController({
      handleCopyFundingAccount: jest.fn(async () => {
        throw new Error('copy failed');
      }),
      submitSavingsGoal: jest.fn(async () => {
        throw new Error('retry failed');
      }),
    });
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Copy savings funding account number',
      })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry savings creation' })
    );

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        'Unable to copy account',
        expect.any(Error)
      );
      expect(errorSpy).toHaveBeenCalledWith(
        'Unable to retry savings',
        expect.any(Error)
      );
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to copy account',
        'Failed to copy funding account. Please try again.'
      );
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to retry savings',
        'Failed to retry savings creation. Please try again.'
      );
    });

    errorSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('disables copy action while the copy request is pending', async () => {
    let resolveCopy: (() => void) | undefined;
    const controller = createController({
      handleCopyFundingAccount: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCopy = resolve;
          })
      ),
    });
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Copy savings funding account number',
      })
    );

    expect(screen.getByText('Copying...')).toBeOnTheScreen();

    await act(async () => {
      resolveCopy?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('Copy account')).toBeOnTheScreen();
    });
  });

  it('shows a fallback when no funding account is available', () => {
    render(
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={createController({ fundingAccount: null })}
      />
    );

    expect(
      screen.getByText(
        'Create your account number from the wallet funding screen before continuing.'
      )
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', {
        name: 'Copy savings funding account number',
      })
    ).toBeNull();
  });

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
      expect(
        screen.queryByText('Fund wallet to continue')
      ).not.toBeOnTheScreen();
      fireEvent.changeText(
        screen.getByLabelText('BVN for plan account'),
        '00000000000'
      );
      fireEvent.press(
        screen.getByRole('button', { name: 'Show plan account' })
      );

      await waitFor(() =>
        expect(controller.fetchPlanFunding).toHaveBeenCalledWith(
          '00000000000',
          { enableInterestAccrual: false }
        )
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
      fireEvent.press(
        screen.getByRole('button', { name: 'Show plan account' })
      );

      await waitFor(() =>
        expect(controller.fetchPlanFunding).toHaveBeenCalledWith(
          '00000000000',
          { enableInterestAccrual: true }
        )
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

    it('falls back to the wallet contribution when the plan account is unavailable', async () => {
      const controller = createPlanController({
        fundingAccount: {
          account_name: 'Synthetic Wallet Account',
          account_number: '0123456789',
          bank_name: 'Titan Paystack',
          provider: 'paystack',
        },
        planFundingPhase: 'unavailable',
      });
      render(
        <StartSavingsTransferModal
          colors={Colors.light}
          controller={controller}
        />
      );

      expect(screen.getByText('0123456789')).toBeOnTheScreen();
      fireEvent.press(
        screen.getByRole('button', { name: 'Record wallet contribution' })
      );

      await waitFor(() =>
        expect(controller.submitBankTransferContribution).toHaveBeenCalledTimes(
          1
        )
      );
    });
  });
});
