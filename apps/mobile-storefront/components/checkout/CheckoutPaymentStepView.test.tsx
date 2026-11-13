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

function renderStep(selectedPayment: StepProps['selectedPayment']) {
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
});
