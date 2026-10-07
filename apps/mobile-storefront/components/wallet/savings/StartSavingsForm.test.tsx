import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { StartSavingsForm } from './StartSavingsForm';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsController } from './start-savings-controller.types';

function createController(
  overrides: Partial<StartSavingsController> = {}
): StartSavingsController {
  return {
    acceptsNonWithdrawableTerms: false,
    contributionAmount: '20000',
    contributionValue: 20000,
    effectiveInitialContribution: 0,
    variantOptionGroups: [],
    debouncedSearch: '',
    formError: null,
    frequency: 'daily',
    handleContinue: jest.fn(),
    handleSourceModeChange: jest.fn(),
    initialContributionAmount: '',
    initialContributionEnabled: false,
    isProductsLoading: false,
    isSubmitting: false,
    preferredDebitTime: '06:20',
    products: [],
    searchValue: '',
    selectProduct: jest.fn(),
    selectedProduct: {
      id: 'phone',
      name: 'Phone',
      image: '',
      slug: 'phone',
      price: 100000,
      variantId: null,
      requiresVariantSelection: false,
    },
    setAcceptsNonWithdrawableTerms: jest.fn(),
    setContributionAmount: jest.fn(),
    setFrequency: jest.fn(),
    setInitialContributionAmount: jest.fn(),
    setInitialContributionEnabled: jest.fn(),
    setPreferredDebitTime: jest.fn(),
    setSearchValue: jest.fn(),
    setStartDate: jest.fn(),
    setTargetAmount: jest.fn(),
    sourceMode: 'manual',
    startDate: '2026-05-22',
    targetAmount: '',
    ...overrides,
  } as unknown as StartSavingsController;
}

describe('StartSavingsForm', () => {
  it('does not offer auto debit when the hosted staging payment route is absent', () => {
    const previousValue = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    try {
      render(
        <StartSavingsForm
          colors={Colors.light}
          controller={createController()}
        />
      );
      expect(
        screen.queryByRole('radio', { name: 'Use auto debit for savings' })
      ).toBeNull();
      expect(
        screen.getByText(/Auto debit is not available in this staging build/)
      ).toBeOnTheScreen();
    } finally {
      if (previousValue === undefined)
        delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
      else process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = previousValue;
    }
  });

  it('preserves press feedback without losing the static CTA surface', () => {
    render(
      <StartSavingsForm colors={Colors.light} controller={createController()} />
    );
    const button = screen.getByRole('button', {
      name: 'Continue savings setup',
    });
    expect(button).toHaveStyle(styles.primaryButton);
    fireEvent(button, 'pressIn');
    expect(button).toHaveStyle({ ...styles.primaryButton, opacity: 0.7 });
    fireEvent(button, 'pressOut');
    expect(button).not.toHaveStyle({ opacity: 0.7 });
    expect(button).toHaveStyle(styles.primaryButton);
  });
  it('renders form fields and continues setup', () => {
    const setAcceptsNonWithdrawableTerms = jest.fn();
    const controller = createController({ setAcceptsNonWithdrawableTerms });
    render(<StartSavingsForm colors={Colors.light} controller={controller} />);

    expect(screen.queryByLabelText('Plan wallet staging preview')).toBeNull();
    expect(screen.getByText('Dream it.\nSave for it.')).toBeOnTheScreen();
    expect(
      screen.getByText('Your next device, one little win at a time.')
    ).toBeOnTheScreen();
    expect(screen.getByText('03 · Choose how you fund it')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'I understand savings are reserved for my selected purchase and cannot be withdrawn to a bank account.'
      )
    ).toBeOnTheScreen();

    fireEvent.changeText(
      screen.getByLabelText('Savings contribution amount'),
      '20000'
    );
    fireEvent.press(
      screen.getByRole('radio', { name: 'Initial contribution Yes' })
    );
    fireEvent.press(
      screen.getByRole('radio', { name: 'Use auto debit for savings' })
    );
    fireEvent.press(
      screen.getByRole('checkbox', {
        name: 'Accept non-withdrawable savings terms',
      })
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Continue savings setup' })
    );

    expect(controller.setContributionAmount).toHaveBeenCalledWith('20000');
    expect(controller.setInitialContributionEnabled).toHaveBeenCalledWith(true);
    expect(controller.handleSourceModeChange).toHaveBeenCalledWith(
      'auto_debit'
    );
    expect(setAcceptsNonWithdrawableTerms).toHaveBeenCalledWith(
      expect.any(Function)
    );
    expect(controller.handleContinue).toHaveBeenCalledTimes(1);
  });

  it('shows form errors and disables continue while submitting', () => {
    render(
      <StartSavingsForm
        colors={Colors.light}
        controller={createController({
          formError: 'Enter a valid contribution amount.',
          isSubmitting: true,
        })}
      />
    );

    expect(
      screen.getByText('Enter a valid contribution amount.')
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Continue savings setup' })
    ).toBeDisabled();
  });
});
