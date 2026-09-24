import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  PaymentMethodSelector,
  type PaymentMethodType,
} from './PaymentMethodSelector';

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('PaymentMethodSelector', () => {
  it('shows the Lagos availability note for pay on delivery without the removed fee copy', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'pay_on_delivery' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="full"
        onSelectTab={() => {}}
        orderTotal={120000}
      />
    );

    expect(screen.getByText('Available in Lagos only.')).toBeTruthy();
    expect(screen.queryByText(/5% processing fee may apply/i)).toBeNull();
  });

  it('shows reordered installment providers with the requested messaging', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'credit_direct' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="installments"
        onSelectTab={() => {}}
        orderTotal={120000}
      />
    );

    // The redundant "Buy Now Pay Later / Split your order..." lines were
    // removed (they duplicated the "Pay Small Small" card subtitle). Only the
    // additive note + the per-provider downpayment info remain.
    expect(
      screen.getByText('Interest rates vary. Breakdown shown during Checkout')
    ).toBeTruthy();
    expect(screen.getByText('Credit Direct')).toBeTruthy();
    expect(screen.getByText('CredPal')).toBeTruthy();
    expect(screen.getByText('Salary Earners and Business Owners')).toBeTruthy();
    expect(screen.getByText('Salary Earners Only')).toBeTruthy();
  });

  it('surfaces the invoice and pay-for-me intents and pins their method on select', () => {
    const onSelectTab = jest.fn();
    const onSelectMethod = jest.fn();

    render(
      <PaymentMethodSelector
        selectedMethod={'invoice' as PaymentMethodType}
        onSelectMethod={onSelectMethod}
        selectedTab="pay_later"
        onSelectTab={onSelectTab}
        orderTotal={120000}
      />
    );

    expect(screen.getByText('Get a Proforma Invoice')).toBeTruthy();
    expect(screen.getByText('Pay for Me')).toBeTruthy();

    // Selecting a terminal pay_later intent projects onto BOTH the tab and its
    // pinned method (onSelectTab alone would auto-pick invoice, not payforme).
    fireEvent.press(screen.getByRole('radio', { name: /Pay for Me/ }));
    expect(onSelectTab).toHaveBeenCalledWith('pay_later');
    expect(onSelectMethod).toHaveBeenCalledWith('payforme');
  });

  it('filters terminal pay-later intents by the enabled methods', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'invoice' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="pay_later"
        onSelectTab={() => {}}
        orderTotal={120000}
        enabledMethods={['invoice']}
      />
    );

    expect(screen.getByText('Get a Proforma Invoice')).toBeTruthy();
    expect(screen.queryByText('Pay for Me')).toBeNull();
  });

  it('hides the Pay Small Small intent when no BNPL methods are enabled', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'invoice' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="pay_later"
        onSelectTab={() => {}}
        orderTotal={120000}
        enabledMethods={['invoice', 'payforme']}
      />
    );

    expect(screen.queryByText('Pay Small Small')).toBeNull();
    expect(screen.getByText('Get a Proforma Invoice')).toBeTruthy();
    expect(screen.getByText('Pay for Me')).toBeTruthy();
  });

  it('keeps the Pay Small Small intent visible when Klump is the only enabled BNPL provider', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'klump' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="installments"
        onSelectTab={() => {}}
        orderTotal={120000}
        enabledMethods={['klump' as PaymentMethodType]}
      />
    );

    expect(screen.getByText('Pay Small Small')).toBeTruthy();
    expect(screen.getByText('Klump')).toBeTruthy();
  });

  it('shows Klump at exactly the maximum order amount', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'klump' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="installments"
        onSelectTab={() => {}}
        orderTotal={1_000_000}
        enabledMethods={['klump' as PaymentMethodType]}
      />
    );

    expect(screen.getByText('Pay Small Small')).toBeTruthy();
    expect(screen.getByText('Klump')).toBeTruthy();
  });

  it('does not show Klump above the maximum order amount', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'klump' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="installments"
        onSelectTab={() => {}}
        orderTotal={1_000_001}
        enabledMethods={['klump' as PaymentMethodType]}
        hiddenMethods={['klump' as PaymentMethodType]}
        methodDisabledReasons={{ klump: 'Maximum order: ₦1,000,000' }}
      />
    );

    expect(screen.queryByText('Klump')).toBeNull();
    expect(screen.queryByText('Pay Small Small')).toBeNull();
  });

  it('disables the Pay Small Small intent below the BNPL minimum and shows the eligibility hint', () => {
    const onSelectTab = jest.fn();
    const onSelectMethod = jest.fn();

    render(
      <PaymentMethodSelector
        selectedMethod={'klump' as PaymentMethodType}
        onSelectMethod={onSelectMethod}
        selectedTab="installments"
        onSelectTab={onSelectTab}
        orderTotal={5000}
        enabledMethods={['klump' as PaymentMethodType]}
      />
    );

    const intentCard = screen.getByRole('radio', { name: /Pay Small Small/ });

    expect(intentCard.props.accessibilityState).toMatchObject({
      disabled: true,
    });
    // Below the BNPL floor the whole intent is unavailable; a plain-language
    // hint replaces the marketing subtitle instead of expanding disabled rows.
    expect(screen.getByText('Available for orders from ₦10,000')).toBeTruthy();

    fireEvent.press(intentCard);

    expect(onSelectTab).toHaveBeenCalledWith('full');
    expect(onSelectMethod).not.toHaveBeenCalled();
  });

  it('disables Klump when wallet credit is already active', () => {
    const onSelectMethod = jest.fn();

    render(
      <PaymentMethodSelector
        selectedMethod={'klump' as PaymentMethodType}
        onSelectMethod={onSelectMethod}
        selectedTab="installments"
        onSelectTab={() => {}}
        orderTotal={120000}
        enabledMethods={['klump' as PaymentMethodType]}
        walletSelection={{ use: true, amount: 5000 }}
      />
    );

    const klumpRow = screen.getByLabelText(
      'Klump. Wallet credit cannot be combined with Klump'
    );

    expect(
      screen.getByText('Wallet credit cannot be combined with Klump')
    ).toBeTruthy();

    fireEvent.press(klumpRow);

    expect(onSelectMethod).not.toHaveBeenCalled();
  });

  it('disables Klump when device savings credit is already active', () => {
    const onSelectMethod = jest.fn();

    render(
      <PaymentMethodSelector
        selectedMethod={'klump' as PaymentMethodType}
        onSelectMethod={onSelectMethod}
        selectedTab="installments"
        onSelectTab={() => {}}
        orderTotal={120000}
        enabledMethods={['klump' as PaymentMethodType]}
        savingsSelection={{
          use: true,
          goalId: '123e4567-e89b-12d3-a456-426614174555',
          amount: 5000,
        }}
      />
    );

    const klumpRow = screen.getByLabelText(
      'Klump. Device savings cannot be combined with Klump'
    );

    expect(
      screen.getByText('Device savings cannot be combined with Klump')
    ).toBeTruthy();

    fireEvent.press(klumpRow);

    expect(onSelectMethod).not.toHaveBeenCalled();
  });

  it('can show Paystack as an unselected alternate card option when a saved card owns the selection', () => {
    const onSelectMethod = jest.fn();

    render(
      <PaymentMethodSelector
        selectedMethod={'paystack' as PaymentMethodType}
        onSelectMethod={onSelectMethod}
        selectedTab="full"
        onSelectTab={() => {}}
        orderTotal={1000}
        enabledMethods={['paystack']}
        suppressedSelectedMethods={['paystack']}
        methodLabelOverrides={{ paystack: 'Use another card' }}
      />
    );

    const alternateCard = screen.getByLabelText(
      'Use another card. Visa, Mastercard, Verve'
    );

    expect(screen.queryByText('Pay with Card')).toBeNull();

    fireEvent.press(alternateCard);

    expect(onSelectMethod).toHaveBeenCalledWith('paystack');
  });

  it('applies payment method description and badge overrides', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'paystack' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="full"
        onSelectTab={() => {}}
        orderTotal={1000}
        enabledMethods={['paystack', 'bank_transfer']}
        methodDescriptionOverrides={{
          paystack: '2x cashback on your first card payment',
        }}
        methodBadgeOverrides={{ paystack: '2x cashback' }}
      />
    );

    expect(screen.getByText('Pay with Card')).toBeTruthy();
    expect(
      screen.getByText('2x cashback on your first card payment')
    ).toBeTruthy();
    expect(screen.getByText('2x cashback')).toBeTruthy();
    expect(screen.getByText('Bank Transfer')).toBeTruthy();
  });

  it('shows wallet-funded bank-transfer copy and guidance when enabled', () => {
    render(
      <PaymentMethodSelector
        selectedMethod={'bank_transfer' as PaymentMethodType}
        onSelectMethod={() => {}}
        selectedTab="full"
        onSelectTab={() => {}}
        orderTotal={250000}
        enabledMethods={['bank_transfer']}
        methodLabelOverrides={{ bank_transfer: 'Bank transfer to wallet' }}
        methodDescriptionOverrides={{
          bank_transfer:
            'A permanent account number will be created for you which you can use for future purchases. We apply it to this order automatically.',
        }}
        walletFundedBankTransferMode
      />
    );

    expect(screen.getByText('Bank transfer to wallet')).toBeTruthy();
    expect(
      screen.getByText(
        'A permanent account number will be created for you which you can use for future purchases. We apply it to this order automatically.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        'We will fund your wallet and pay this order automatically.'
      )
    ).toBeTruthy();
  });

  describe('wallet payment row', () => {
    // Storefront checkout opts in via walletMode='orders'. VTU's
    // UtilityPaymentOptions caller intentionally omits the prop (defaults
    // to 'off') until PR B's server support exists, so the wallet row
    // stays hidden in VTU until that lands. The hook call (useWallet)
    // lives in the parent — the selector is presentation-only and
    // receives `walletBalance` as a prop.

    it('renders nothing wallet-related when walletMode is off (default — regression-pin for VTU)', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletBalance={800}
          walletOrderTotal={1000}
        />
      );

      expect(screen.queryByLabelText(/wallet/i)).toBeNull();
      expect(screen.queryByText(/wallet credit/i)).toBeNull();
    });

    it('renders nothing wallet-related when walletMode is orders but balance is 0', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={0}
          walletOrderTotal={1000}
        />
      );

      expect(screen.queryByLabelText(/wallet/i)).toBeNull();
    });

    it('renders a disabled wallet status row while the VTU wallet balance is loading', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="vtu"
          walletBalance={0}
          walletOrderTotal={1000}
          walletIsLoading
        />
      );

      const walletRow = screen.getByLabelText(
        'Wallet. Checking wallet balance'
      );

      expect(walletRow.props.accessibilityState).toMatchObject({
        disabled: true,
      });
      expect(screen.getByText('Checking wallet balance')).toBeTruthy();
    });

    it('renders a disabled wallet status row when the VTU wallet balance cannot be loaded', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="vtu"
          walletBalance={0}
          walletOrderTotal={1000}
          walletError={new Error('wallet unavailable')}
        />
      );

      const walletRow = screen.getByLabelText(
        'Wallet unavailable. Use card while wallet refreshes'
      );

      expect(walletRow.props.accessibilityState).toMatchObject({
        disabled: true,
      });
      expect(screen.getByText('Wallet unavailable')).toBeTruthy();
    });

    it('renders the wallet row in partial-deductible mode when balance < orderTotal', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={800}
          walletOrderTotal={1000}
        />
      );

      // Wallet row exposes its balance and the partial-deductible affordance
      // so the user can see how much will be charged to the card.
      expect(screen.getByLabelText(/use wallet credit/i)).toBeTruthy();
      expect(screen.getByText(/₦800/)).toBeTruthy();
      expect(screen.getByText(/₦200/)).toBeTruthy(); // residual to card
    });

    it('renders the wallet row in full-coverage mode when balance >= orderTotal', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={1500}
          walletOrderTotal={1000}
        />
      );

      // Full coverage variant: wallet covers entire order, no card needed
      // for this transaction. UI should make that explicit.
      expect(screen.getByLabelText(/pay with wallet/i)).toBeTruthy();
      expect(screen.getByText(/₦1,500/)).toBeTruthy();
    });

    it('emits walletSelection with use=true and amount=balance when partial wallet is toggled on', () => {
      const onWalletToggle = jest.fn();

      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={800}
          walletOrderTotal={1000}
          onWalletToggle={onWalletToggle}
        />
      );

      fireEvent.press(screen.getByLabelText(/use wallet credit/i));

      expect(onWalletToggle).toHaveBeenCalledWith({ use: true, amount: 800 });
    });

    it('emits walletSelection with use=true and amount=orderTotal when wallet covers in full', () => {
      const onWalletToggle = jest.fn();

      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={1500}
          walletOrderTotal={1000}
          onWalletToggle={onWalletToggle}
        />
      );

      fireEvent.press(screen.getByLabelText(/pay with wallet/i));

      expect(onWalletToggle).toHaveBeenCalledWith({ use: true, amount: 1000 });
    });

    it('shows the wallet row when the BNPL tab is selected (installments)', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'credit_direct' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="installments"
          onSelectTab={() => {}}
          orderTotal={120000}
          walletMode="orders"
          walletBalance={5000}
          walletOrderTotal={120000}
        />
      );

      expect(screen.getByLabelText(/use wallet credit/i)).toBeTruthy();
    });

    it('shows the wallet row when the pay_later tab is selected', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'invoice' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="pay_later"
          onSelectTab={() => {}}
          orderTotal={5000}
          walletMode="orders"
          walletBalance={5000}
          walletOrderTotal={5000}
        />
      );

      expect(screen.getByLabelText(/pay with wallet/i)).toBeTruthy();
    });

    it.each([
      'pay_on_delivery',
      'juicyway',
    ] as const)('hides the wallet row for %s (no real-time settlement of residual)', (method) => {
      render(
        <PaymentMethodSelector
          selectedMethod={method as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={5000}
          walletMode="orders"
          walletBalance={3000}
          walletOrderTotal={5000}
        />
      );

      expect(screen.queryByLabelText(/wallet/i)).toBeNull();
    });

    it.each([
      'paystack',
      'korapay',
      'bank_transfer',
    ] as const)('shows the wallet row for %s (gateway can settle the residual)', (method) => {
      render(
        <PaymentMethodSelector
          selectedMethod={method as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={5000}
          walletMode="orders"
          walletBalance={3000}
          walletOrderTotal={5000}
        />
      );

      expect(screen.getByLabelText(/use wallet credit/i)).toBeTruthy();
    });

    it('renders wallet balance as informational copy in wallet-funded bank-transfer mode', () => {
      const onWalletToggle = jest.fn();

      render(
        <PaymentMethodSelector
          selectedMethod={'bank_transfer' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={5000}
          walletMode="orders"
          walletBalance={3000}
          walletOrderTotal={5000}
          onWalletToggle={onWalletToggle}
          walletFundedBankTransferMode
        />
      );

      expect(screen.queryByLabelText(/use wallet credit/i)).toBeNull();
      expect(
        screen.getByText('Wallet balance applies automatically')
      ).toBeTruthy();
      expect(
        screen.getByText('₦3,000 available now · transfer shortfall only')
      ).toBeTruthy();
      expect(onWalletToggle).not.toHaveBeenCalled();
    });

    it('suppresses the active-radio visual on gateway rows when wallet fully covers and is active', () => {
      // Regression: when wallet covers the full order AND the toggle is
      // on, the gateway list becomes informational. Showing two competing
      // active radios (wallet row + gateway row) is confusing UX. The
      // gateway rows render with checked=false and disabled=true while
      // the wallet selection is active, so only the wallet row appears
      // selected. The underlying `selectedMethod` prop is preserved
      // unchanged.
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={1500}
          walletOrderTotal={1000}
          walletSelection={{ use: true, amount: 1000 }}
          onWalletToggle={() => {}}
        />
      );

      const paystackRow = screen.getByLabelText(/Pay with Card/i);
      // Gateway row is no longer the active selection while wallet
      // covers fully and is selected.
      expect(paystackRow.props.accessibilityState.checked).toBe(false);
      expect(paystackRow.props.accessibilityState.disabled).toBe(true);
    });

    it('emits walletSelection with use=false when toggled off', () => {
      const onWalletToggle = jest.fn();

      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={1000}
          walletMode="orders"
          walletBalance={800}
          walletOrderTotal={1000}
          walletSelection={{ use: true, amount: 800 }}
          onWalletToggle={onWalletToggle}
        />
      );

      fireEvent.press(screen.getByLabelText(/use wallet credit/i));

      expect(onWalletToggle).toHaveBeenCalledWith({ use: false, amount: 0 });
    });
  });

  describe('payment intent accordion', () => {
    it('renders the four intent-first options as a radiogroup', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={120000}
        />
      );

      expect(screen.getByText('Pay in Full')).toBeTruthy();
      expect(screen.getByText('Pay Small Small')).toBeTruthy();
      expect(screen.getByText('Pay for Me')).toBeTruthy();
      expect(screen.getByText('Get a Proforma Invoice')).toBeTruthy();
      expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(4);
    });

    it('expands only the selected instrument-bearing intent (single-open)', () => {
      render(
        <PaymentMethodSelector
          selectedMethod={'paystack' as PaymentMethodType}
          onSelectMethod={() => {}}
          selectedTab="full"
          onSelectTab={() => {}}
          orderTotal={120000}
          enabledMethods={['paystack', 'credit_direct']}
        />
      );

      // `full` is selected → its card instruments are visible...
      expect(screen.getByText('Pay with Card')).toBeTruthy();
      // ...while the collapsed `installments` card keeps its BNPL rows hidden.
      expect(screen.queryByText('Credit Direct')).toBeNull();
    });
  });
});
