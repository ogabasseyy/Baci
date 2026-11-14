import { render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { CheckoutPaymentStepView } from './CheckoutPaymentStepView';

type CapturedSelectorProps = { initiallyCollapsed?: boolean };

const mockSelectorProps = jest.fn<void, [CapturedSelectorProps]>();

jest.mock('@/components/checkout/PaymentMethodSelector', () => ({
  PaymentMethodSelector: (props: CapturedSelectorProps) => {
    mockSelectorProps(props);
    return null;
  },
}));
jest.mock('@/components/checkout/redvault/RedvaultPaymentChoice', () => ({
  RedvaultPaymentChoice: () => null,
}));
jest.mock('@/components/checkout/CheckoutSavingsRetryCard', () => ({
  CheckoutSavingsRetryCard: () => null,
}));

type StepProps = Parameters<typeof CheckoutPaymentStepView>[0];

function renderStep(
  selectedPayment: StepProps['selectedPayment'],
  overrides: Partial<StepProps> = {}
) {
  const props: StepProps = {
    availablePaymentMethods: undefined,
    checkoutSavingsBalance: 0,
    checkoutSavingsError: null,
    checkoutSavingsGoal: null,
    colors: Colors.light,
    formContentPaddingBottom: 0,
    hiddenPaymentMethods: undefined,
    isDark: false,
    isLoadingCheckoutSavings: false,
    klumpDisabledReason: undefined,
    onRetrySavings: jest.fn(),
    onSavingsToggle: jest.fn(),
    onSelectPayment: jest.fn(),
    onSelectPaymentTab: jest.fn(),
    onWalletToggle: jest.fn(),
    redvaultAvailable: false,
    paymentTab: 'full',
    savingsSelection: undefined,
    selectedPayment,
    total: 250000,
    walletBalance: 0,
    walletFundedBankTransferOptionEnabled: false,
    walletSelection: undefined,
    ...overrides,
  };
  render(<CheckoutPaymentStepView {...props} />);
  const lastCall = mockSelectorProps.mock.calls.at(-1);
  if (!lastCall) throw new Error('PaymentMethodSelector was not rendered');
  return lastCall[0];
}

describe('CheckoutPaymentStepView', () => {
  beforeEach(() => mockSelectorProps.mockClear());

  it('opens fully collapsed on the first visit, before a method is chosen', () => {
    expect(renderStep(null).initiallyCollapsed).toBe(true);
  });

  // Coming back from Review remounts the step: the chosen method must stay
  // visible instead of hiding inside a collapsed "Pay in Full" card.
  it('keeps the selected method visible when returning from Review', () => {
    expect(renderStep('paystack').initiallyCollapsed).toBe(false);
  });

  it('keeps a wallet-only payment visible when returning from Review', () => {
    const props = renderStep(null, {
      walletSelection: { use: true, amount: 250000 },
    });
    expect(props.initiallyCollapsed).toBe(false);
  });

  it('keeps a savings-only payment visible when returning from Review', () => {
    const props = renderStep(null, {
      savingsSelection: { use: true, goalId: 'goal-1', amount: 250000 },
    });
    expect(props.initiallyCollapsed).toBe(false);
  });

  it('still collapses when wallet and savings are present but unused', () => {
    const props = renderStep(null, {
      savingsSelection: { use: false, goalId: null, amount: 0 },
      walletSelection: { use: false, amount: 0 },
    });
    expect(props.initiallyCollapsed).toBe(true);
  });
});
