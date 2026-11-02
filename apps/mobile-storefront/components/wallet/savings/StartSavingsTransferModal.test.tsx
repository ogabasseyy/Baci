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
});
