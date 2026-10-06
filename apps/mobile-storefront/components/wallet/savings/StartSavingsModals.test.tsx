import { describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import Colors from '@/constants/Colors';
import { StartSavingsModals } from './StartSavingsModals';
import type { StartSavingsController } from './start-savings-controller.types';

const mockLogError = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: (...args: unknown[]) => mockLogError(...args),
  }),
}));

function createController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    contributionValue: 20000,
    effectiveInitialContribution: 20000,
    frequency: 'daily',
    goToWallet: jest.fn(),
    handleAuthorizeSavingsCard: jest.fn(async () => undefined),
    handleCopyFundingAccount: jest.fn(async () => undefined),
    handleFundingContinue: jest.fn(async () => undefined),
    isAuthorizingCard: false,
    isLoadingPaymentMethods: false,
    isSubmitting: false,
    maturityDate: '2026-06-30',
    openWalletFundingScreen: jest.fn(),
    paymentMethodsError: null,
    requiredTopUpAmount: 50000,
    safeWalletBalance: 10000,
    savedPaymentMethods: [],
    selectedFundingOption: 'wallet',
    selectedPaymentMethodId: null,
    selectedProduct: {
      id: 'product-1',
      name: 'iPhone 13 Pro Max',
      price: 800000,
      slug: 'iphone-13-pro-max',
    },
    setPaymentMethodsError: jest.fn(),
    setSelectedFundingOption: jest.fn(),
    setSelectedPaymentMethodId: jest.fn(),
    setShowFundingModal: jest.fn(),
    setShowPreviewModal: jest.fn(),
    showFundingModal: false,
    showPreviewModal: true,
    showSuccessModal: false,
    showTransferModal: false,
    sourceMode: 'manual',
    submitSavingsGoal: jest.fn(async () => undefined),
    targetValue: 800000,
    ...overrides,
  } as StartSavingsController;
}

describe('StartSavingsModals', () => {
  it('keeps one visible sheet when moving from review to funding', () => {
    const controller = createController();
    const view = render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );
    expect(
      view
        .UNSAFE_getAllByType(ModalSheet)
        .filter((sheet) => sheet.props.visible)
    ).toHaveLength(1);

    view.rerender(
      <StartSavingsModals
        colors={Colors.light}
        controller={{
          ...controller,
          showPreviewModal: false,
          showFundingModal: true,
        }}
      />
    );
    expect(
      view
        .UNSAFE_getAllByType(ModalSheet)
        .filter((sheet) => sheet.props.visible)
    ).toHaveLength(1);
    expect(screen.getByText('Payment Methods')).toBeOnTheScreen();
  });

  it('previews the plan and opens funding options', () => {
    const controller = createController();
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    expect(screen.getByText('Your savings plan')).toBeOnTheScreen();
    expect(screen.getByText('iPhone 13 Pro Max')).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole('button', { name: 'Choose savings funding option' })
    );

    expect(controller.setShowPreviewModal).toHaveBeenCalledWith(false);
    expect(controller.setShowFundingModal).toHaveBeenCalledWith(true);
  });

  it('renders manual funding options and continues', () => {
    const controller = createController({
      showFundingModal: true,
      showPreviewModal: false,
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Pay with bank transfer' })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue funding option' })
    );

    expect(controller.setSelectedFundingOption).toHaveBeenCalledWith(
      'bank_transfer'
    );
    expect(controller.handleFundingContinue).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed funding response visible without dismissing the sheet', () => {
    const controller = createController({
      formError: 'Unable to create savings plan. Please retry.',
      showFundingModal: true,
      showPreviewModal: false,
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to create savings plan. Please retry.'
    );
    expect(screen.getByText('Payment Methods')).toBeOnTheScreen();
  });

  it('logs rejected funding continuations instead of leaving an unhandled promise', async () => {
    mockLogError.mockClear();
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const controller = createController({
      handleFundingContinue: jest.fn(async () => {
        throw new Error('continue failed');
      }),
      showFundingModal: true,
      showPreviewModal: false,
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Continue funding option' })
    );

    await waitFor(() => {
      expect(mockLogError).toHaveBeenCalledWith('Savings modal action failed', {
        error: expect.any(Error),
        operation: 'Savings funding continue',
      });
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to continue',
        'Please try the savings funding step again.'
      );
    });

    alertSpy.mockRestore();
  });

  it('renders auto-debit saved methods and authorization action', () => {
    const controller = createController({
      savedPaymentMethods: [
        {
          bank: 'Access Bank',
          brand: 'visa',
          exp_month: '08',
          exp_year: '2030',
          id: 'card-1',
          is_default: true,
          label: 'Access Bank ending 1234',
          last4: '1234',
          provider: 'paystack',
        },
      ],
      showFundingModal: true,
      showPreviewModal: false,
      sourceMode: 'auto_debit',
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Select Access Bank ending 1234' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Add savings card' }));

    expect(controller.setSelectedPaymentMethodId).toHaveBeenCalledWith(
      'card-1'
    );
    expect(controller.setPaymentMethodsError).toHaveBeenCalledWith(null);
    expect(controller.handleAuthorizeSavingsCard).toHaveBeenCalledTimes(1);
  });

  it('logs rejected card authorization attempts instead of leaving an unhandled promise', async () => {
    mockLogError.mockClear();
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const controller = createController({
      handleAuthorizeSavingsCard: jest.fn(async () => {
        throw new Error('authorization failed');
      }),
      showFundingModal: true,
      showPreviewModal: false,
      sourceMode: 'auto_debit',
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Add savings card' }));

    await waitFor(() => {
      expect(mockLogError).toHaveBeenCalledWith('Savings modal action failed', {
        error: expect.any(Error),
        operation: 'Savings card authorization',
      });
      expect(alertSpy).toHaveBeenCalledWith(
        'Unable to add card',
        'Please try adding your card again.'
      );
    });

    alertSpy.mockRestore();
  });

  it('renders payment-method loading and error states', () => {
    const controller = createController({
      isLoadingPaymentMethods: true,
      paymentMethodsError: 'Unable to load saved cards.',
      showFundingModal: true,
      showPreviewModal: false,
      sourceMode: 'auto_debit',
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    expect(
      screen.getByLabelText('Loading savings payment methods')
    ).toBeOnTheScreen();
    expect(screen.getByText('Unable to load saved cards.')).toBeOnTheScreen();
  });

  it('disables authorization while card authorization is opening', () => {
    const controller = createController({
      isAuthorizingCard: true,
      showFundingModal: true,
      showPreviewModal: false,
      sourceMode: 'auto_debit',
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    expect(screen.getByText('Opening secure checkout…')).toBeOnTheScreen();
    expect(screen.getByText('Authorizing card...')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Add savings card' }));

    expect(controller.handleAuthorizeSavingsCard).not.toHaveBeenCalled();
  });

  it('disables funding continue while submitting', () => {
    const controller = createController({
      isSubmitting: true,
      showFundingModal: true,
      showPreviewModal: false,
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    expect(screen.getByText('Processing...')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue funding option' })
    );

    expect(controller.handleFundingContinue).not.toHaveBeenCalled();
  });

  it('renders success modal wallet navigation', () => {
    const controller = createController({
      showPreviewModal: false,
      showSuccessModal: true,
    });
    render(
      <StartSavingsModals colors={Colors.light} controller={controller} />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Go to wallet' }));

    expect(controller.goToWallet).toHaveBeenCalledTimes(1);
  });
});
