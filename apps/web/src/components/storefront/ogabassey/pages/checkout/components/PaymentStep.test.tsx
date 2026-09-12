import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PaymentStep } from './PaymentStep';
import type { PaymentMethod, PaymentTab } from '../types';

// Mock PaymentLogos module
vi.mock('../../../components/PaymentLogos', () => ({
  PaystackLogo: vi.fn(({ className }) => <div data-testid="paystack-logo" className={className} />),
  KorapayLogo: vi.fn(({ className }) => <div data-testid="korapay-logo" className={className} />),
  CredPalLogo: vi.fn(({ className }) => <div data-testid="credpal-logo" className={className} />),
  CreditDirectLogo: vi.fn(({ className }) => <div data-testid="credit-direct-logo" className={className} />),
  JuicywayLogo: vi.fn(({ className }) => <div data-testid="juicyway-logo" className={className} />),
  BankTransferLogo: vi.fn(({ className }) => <div data-testid="bank-transfer-logo" className={className} />),
}));

type StepName = 'contact' | 'delivery' | 'payment';

interface CompletedSteps {
  contact: boolean;
  delivery: boolean;
}

interface FeatureSettings {
  paystack_enabled?: boolean;
  korapay_enabled?: boolean;
  juicyway_enabled?: boolean;
  pay_on_delivery_enabled?: boolean;
  credpal_enabled?: boolean;
  credit_direct_enabled?: boolean;
  klump_enabled?: boolean;
  klump_min_amount?: number | string | null;
  klump_max_amount?: number | string | null;
  wallet_paystack_dva_enabled?: boolean;
}

describe('PaymentStep', () => {
  const defaultProps = {
    currentStep: 'payment' as StepName,
    completedSteps: { contact: true, delivery: true } as CompletedSteps,
    paymentTab: 'full' as PaymentTab,
    setPaymentTab: vi.fn(),
    paymentMethod: '' as PaymentMethod,
    setPaymentMethod: vi.fn(),
    isProcessing: false,
    isPayForMeValid: true,
    isDeliveryValid: true,
    payForMeDetails: { name: '', contact: '', note: '' },
    setPayForMeDetails: vi.fn(),
    dva: { isInitializingDva: false },
    newsletterOptIn: false,
    setNewsletterOptIn: vi.fn(),
    handlePlaceOrder: vi.fn(),
    setCurrentStep: vi.fn(),
    merchant: { paystack_subaccount_code: 'ACCT_123' },
    user: null,
    remainingAmount: 10000,
    orderAmount: 10000,
    redvaultAvailable: false,
    redvaultStatus: 'idle' as const,
    redvaultSummary: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves an available REDVAULT selection and clears it when availability is revoked', async () => {
    const setPaymentMethod = vi.fn();
    const { rerender } = render(<PaymentStep {...defaultProps} paymentMethod="uba_redvault" redvaultAvailable={true} setPaymentMethod={setPaymentMethod} />);
    expect(screen.getByRole('radio', { name: /pay with uba/i })).toBeChecked();
    expect(setPaymentMethod).not.toHaveBeenCalled();
    rerender(<PaymentStep {...defaultProps} paymentMethod="uba_redvault" redvaultAvailable={false} setPaymentMethod={setPaymentMethod} />);
    await waitFor(() => expect(setPaymentMethod).toHaveBeenCalledWith(''));
    expect(screen.queryByRole('radio', { name: /pay with uba/i })).not.toBeInTheDocument();
  });

  it('does not offer REDVAULT or retain its selection on a non-NGN checkout', async () => {
    const setPaymentMethod = vi.fn();

    render(
      <PaymentStep
        {...defaultProps}
        currency="GHS"
        paymentMethod="uba_redvault"
        redvaultAvailable={true}
        setPaymentMethod={setPaymentMethod}
      />
    );

    expect(screen.queryByRole('radio', { name: /pay with uba/i })).not.toBeInTheDocument();
    await waitFor(() => expect(setPaymentMethod).toHaveBeenCalledWith(''));
  });

  it('clears a REDVAULT selection when its frozen quote has no eligible items', async () => {
    const setPaymentMethod = vi.fn();

    render(
      <PaymentStep
        {...defaultProps}
        paymentMethod="uba_redvault"
        redvaultAvailable={true}
        redvaultSummary={{
          productSubtotalKobo: 10000,
          eligibleSubtotalKobo: 0,
          ineligibleSubtotalKobo: 10000,
          discountKobo: 0,
          assuranceFeeKobo: 0,
          taxKobo: 0,
          shippingKobo: 0,
          giftWrappingKobo: 0,
          payableKobo: 10000,
          mixedBasket: true,
        }}
        setPaymentMethod={setPaymentMethod}
      />
    );

    await waitFor(() => expect(setPaymentMethod).toHaveBeenCalledWith(''));
  });

  it.each(['pending', 'held'] as const)(
    'disables placement while REDVAULT is %s',
    (redvaultStatus) => {
      const handlePlaceOrder = vi.fn();

      render(
        <PaymentStep
          {...defaultProps}
          handlePlaceOrder={handlePlaceOrder}
          paymentMethod="uba_redvault"
          redvaultAvailable={true}
          redvaultStatus={redvaultStatus}
        />
      );

      const placeOrder = screen.getByRole('button', { name: /place order/i });
      expect(placeOrder).toBeDisabled();
      fireEvent.click(placeOrder);
      expect(handlePlaceOrder).not.toHaveBeenCalled();
    }
  );

  describe('Rendering', () => {
    it('renders payment step when currentStep is payment', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} />);

      // Assert
      expect(screen.getByText('Payment Method')).toBeInTheDocument();
    });

    it('applies active styling when currentStep is payment', () => {
      // Arrange & Act
      const { container } = render(<PaymentStep {...defaultProps} />);

      // Assert
      // Now uses the @theme-registered Tailwind utility (`border-store-primary`)
      // instead of the raw arbitrary-value form (`border-(--store-primary)` /
      // `border-[var(--store-primary)]`).
      const stepContainer = container.querySelector('.border-store-primary');
      expect(stepContainer).toBeInTheDocument();
    });

    it('hides payment options visually when currentStep is not payment', () => {
      // Arrange & Act
      const { container } = render(<PaymentStep {...defaultProps} currentStep="contact" />);

      // Assert - the content is rendered but visually hidden via CSS grid-rows-[0fr] opacity-0
      const gridContainer = container.querySelector('.grid-rows-\\[0fr\\]');
      expect(gridContainer).toBeInTheDocument();
      expect(gridContainer?.className).toContain('opacity-0');
    });

    it('shows step number when no payment method is selected', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} />);

      // Assert
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('shows checkmark when payment method is selected', () => {
      // Arrange & Act
      const { container } = render(
        <PaymentStep {...defaultProps} paymentMethod="paystack" />
      );

      // Assert
      const checkIcon = container.querySelector('.text-green-600');
      expect(checkIcon).toBeInTheDocument();
    });
  });

  describe('Pay in Full Options', () => {
    it('shows Paystack when the merchant has a Paystack subaccount', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} />);

      // Assert
      expect(screen.getByText('Paystack')).toBeInTheDocument();
      expect(screen.getByTestId('paystack-logo')).toBeInTheDocument();
    });

    it('hides Bank Transfer when Paystack DVA is not explicitly enabled', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} />);

      // Assert
      expect(
        screen.queryByRole('radio', { name: /^bank transfer/i })
      ).not.toBeInTheDocument();
    });

    it('shows Bank Transfer when Paystack DVA is explicitly enabled', () => {
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: {
          paystack_enabled: true,
          wallet_paystack_dva_enabled: true,
        } as FeatureSettings,
      };

      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      expect(
        screen.getByRole('radio', { name: /^bank transfer/i })
      ).toBeInTheDocument();
    });

    it('hides Paystack on a non-NGN checkout even with a subaccount', () => {
      // Arrange & Act — Paystack settles NGN only; the initialize API rejects
      // it for non-NGN orders with UNSUPPORTED_CURRENCY, so the UI must not
      // offer it.
      render(<PaymentStep {...defaultProps} currency="GHS" />);

      // Assert
      expect(screen.queryByText('Paystack')).not.toBeInTheDocument();
    });

    it('hides Bank Transfer on a non-NGN checkout even when DVA is enabled', () => {
      // Arrange
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: {
          paystack_enabled: true,
          wallet_paystack_dva_enabled: true,
        } as FeatureSettings,
      };

      // Act
      render(
        <PaymentStep {...defaultProps} merchant={merchant} currency="GHS" />
      );

      // Assert
      expect(
        screen.queryByRole('radio', { name: /^bank transfer/i })
      ).not.toBeInTheDocument();
    });

    it('hides Korapay when not explicitly enabled in feature settings', () => {
      render(<PaymentStep {...defaultProps} />);

      expect(screen.queryByText('Korapay')).not.toBeInTheDocument();
      expect(screen.queryByTestId('korapay-logo')).not.toBeInTheDocument();
    });

    it('shows Korapay when explicitly enabled in feature settings', () => {
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: { korapay_enabled: true } as FeatureSettings,
      };

      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      expect(screen.getByText('Korapay')).toBeInTheDocument();
      expect(screen.getByTestId('korapay-logo')).toBeInTheDocument();
    });

    it('hides Paystack when explicitly disabled in feature settings', () => {
      // Arrange
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: { paystack_enabled: false } as FeatureSettings,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.queryByText('Paystack')).not.toBeInTheDocument();
      expect(screen.queryByText('Bank Transfer')).not.toBeInTheDocument();
    });

    it('hides Korapay when explicitly disabled in feature settings', () => {
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: { korapay_enabled: false } as FeatureSettings,
      };

      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      expect(screen.queryByText('Korapay')).not.toBeInTheDocument();
    });

    it('hides Paystack and Bank Transfer when the merchant has no Paystack subaccount', () => {
      // Arrange
      const merchant = {
        paystack_subaccount_code: null,
        feature_settings: { paystack_enabled: true } as FeatureSettings,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.queryByText('Paystack')).not.toBeInTheDocument();
      expect(screen.queryByText('Bank Transfer')).not.toBeInTheDocument();
    });

    it('shows Juicyway when enabled in feature settings', () => {
      // Arrange
      const merchant = {
        feature_settings: { juicyway_enabled: true } as FeatureSettings,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.getByText('Juicyway')).toBeInTheDocument();
      expect(screen.getByTestId('juicyway-logo')).toBeInTheDocument();
    });

    it('hides Juicyway when not enabled in feature settings', () => {
      // Arrange
      const merchant = {
        feature_settings: { juicyway_enabled: false } as FeatureSettings,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.queryByText('Juicyway')).not.toBeInTheDocument();
    });

    it('shows Pay on Delivery when enabled in feature settings', () => {
      // Arrange
      const merchant = {
        feature_settings: { pay_on_delivery_enabled: true } as FeatureSettings,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.getByText('Pay on Delivery')).toBeInTheDocument();
      expect(screen.getByText(/pay when you receive your items/i)).toBeInTheDocument();
    });

    it('calls setPaymentMethod when Paystack is selected', () => {
      // Arrange
      const setPaymentMethod = vi.fn();
      render(<PaymentStep {...defaultProps} setPaymentMethod={setPaymentMethod} />);

      // Act
      const paystackLabel = screen.getByText('Paystack').closest('label');
      if (paystackLabel) fireEvent.click(paystackLabel);

      // Assert
      expect(setPaymentMethod).toHaveBeenCalledWith('paystack');
    });

    it('calls setPaymentMethod when Bank Transfer is selected', () => {
      // Arrange
      const setPaymentMethod = vi.fn();
      render(
        <PaymentStep
          {...defaultProps}
          merchant={{
            paystack_subaccount_code: 'ACCT_123',
            feature_settings: {
              paystack_enabled: true,
              wallet_paystack_dva_enabled: true,
            } as FeatureSettings,
          }}
          setPaymentMethod={setPaymentMethod}
        />
      );

      // Act
      fireEvent.click(screen.getByRole('radio', { name: /^bank transfer/i }));

      // Assert
      expect(setPaymentMethod).toHaveBeenCalledWith('bank_transfer');
    });

    it('calls setPaymentMethod when Korapay is selected', () => {
      const setPaymentMethod = vi.fn();
      render(
        <PaymentStep
          {...defaultProps}
          merchant={{
            paystack_subaccount_code: 'ACCT_123',
            feature_settings: { korapay_enabled: true } as FeatureSettings,
          }}
          setPaymentMethod={setPaymentMethod}
        />
      );

      const korapayLabel = screen.getByText('Korapay').closest('label');
      if (korapayLabel) fireEvent.click(korapayLabel);

      expect(setPaymentMethod).toHaveBeenCalledWith('korapay');
    });

    it('clears a stale Paystack selection when Paystack is unavailable', () => {
      const setPaymentMethod = vi.fn();

      render(
        <PaymentStep
          {...defaultProps}
          merchant={null}
          paymentMethod="paystack"
          setPaymentMethod={setPaymentMethod}
        />
      );

      expect(setPaymentMethod).toHaveBeenCalledWith('');
    });

    it('clears a stale bank transfer selection when bank transfer is unavailable', () => {
      const setPaymentMethod = vi.fn();

      render(
        <PaymentStep
          {...defaultProps}
          merchant={null}
          paymentMethod="bank_transfer"
          setPaymentMethod={setPaymentMethod}
        />
      );

      expect(setPaymentMethod).toHaveBeenCalledWith('');
    });

    it('clears a stale Korapay selection when Korapay is unavailable', () => {
      const setPaymentMethod = vi.fn();

      render(
        <PaymentStep
          {...defaultProps}
          merchant={{
            feature_settings: {
              korapay_enabled: false,
            } as FeatureSettings,
          }}
          paymentMethod="korapay"
          setPaymentMethod={setPaymentMethod}
        />
      );

      expect(setPaymentMethod).toHaveBeenCalledWith('');
    });

    it.each([
      [
        'juicyway',
        {
          feature_settings: { juicyway_enabled: false } as FeatureSettings,
        },
      ],
      [
        'pod',
        {
          feature_settings: {
            pay_on_delivery_enabled: false,
          } as FeatureSettings,
        },
      ],
    ] as const)(
      'clears a stale %s selection when that gateway is unavailable',
      (paymentMethod, merchant) => {
        const setPaymentMethod = vi.fn();

        render(
          <PaymentStep
            {...defaultProps}
            merchant={merchant}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
          />
        );

        expect(setPaymentMethod).toHaveBeenCalledWith('');
      }
    );
  });

  describe('Pay in Installments Options', () => {
    it('shows CredPal when enabled in feature settings', () => {
      // Arrange
      const merchant = {
        feature_settings: { credpal_enabled: true } as FeatureSettings,
      };

      // Act
      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
        />
      );

      // Assert
      expect(screen.getByText('CredPal')).toBeInTheDocument();
      expect(screen.getByTestId('credpal-logo')).toBeInTheDocument();
    });

    it('shows Credit Direct when enabled in feature settings', () => {
      // Arrange
      const merchant = {
        feature_settings: { credit_direct_enabled: true } as FeatureSettings,
      };

      // Act
      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
        />
      );

      // Assert
      expect(screen.getByText('Credit Direct')).toBeInTheDocument();
      expect(screen.getByTestId('credit-direct-logo')).toBeInTheDocument();
    });

    it('shows Klump when enabled in feature settings', () => {
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
        />
      );

      expect(screen.getByText('Klump')).toBeInTheDocument();
      expect(screen.getByText('Split payment at checkout')).toBeInTheDocument();
    });

    it('hides Klump when the order amount is outside merchant bounds', () => {
      const merchant = {
        feature_settings: {
          klump_enabled: true,
          klump_min_amount: 20_000,
          klump_max_amount: 500_000,
        } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          orderAmount={10_000}
          remainingAmount={10_000}
        />
      );

      expect(screen.queryByText('Klump')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Pay in Installments' }),
      ).not.toBeInTheDocument();
    });

    it('uses fallback Klump bounds when merchant limits are blank strings', () => {
      const merchant = {
        feature_settings: {
          klump_enabled: true,
          klump_min_amount: '',
          klump_max_amount: '   ',
        } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          orderAmount={10_000}
          remainingAmount={10_000}
        />
      );

      expect(screen.getByText('Klump')).toBeInTheDocument();
    });

    it('hides Klump above the fallback one million naira maximum', () => {
      const merchant = {
        feature_settings: {
          klump_enabled: true,
          klump_min_amount: '',
          klump_max_amount: '',
        } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          orderAmount={1_000_001}
          remainingAmount={1_000_001}
        />
      );

      expect(screen.queryByText('Klump')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Pay in Installments' }),
      ).not.toBeInTheDocument();
    });

    it('shows Klump at the fallback one million naira maximum boundary', () => {
      const merchant = {
        feature_settings: {
          klump_enabled: true,
          klump_min_amount: '',
          klump_max_amount: '',
        } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          orderAmount={1_000_000}
          remainingAmount={1_000_000}
        />
      );

      expect(screen.getByText('Klump')).toBeInTheDocument();
      expect(
        screen.queryByText(/no installment options are currently available/i),
      ).not.toBeInTheDocument();
    });

    it('checks Klump bounds against the gateway payable amount', () => {
      const merchant = {
        feature_settings: {
          klump_enabled: true,
          klump_min_amount: 10_000,
          klump_max_amount: 10_000,
        } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          orderAmount={10_000.005}
          remainingAmount={10_000}
        />
      );

      expect(screen.getByText('Klump')).toBeInTheDocument();
    });

    it('hides Klump when wallet credit reduces the payable amount', () => {
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          orderAmount={50_000}
          remainingAmount={45_000}
        />
      );

      expect(screen.queryByText('Klump')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Pay in Installments' }),
      ).not.toBeInTheDocument();
    });

    it('hides Klump for non-NGN checkout currency', () => {
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          currency="USD"
        />
      );

      expect(screen.queryByText('Klump')).not.toBeInTheDocument();
    });

    it('allows keyboard focus and selection for the Klump radio', async () => {
      const user = userEvent.setup();
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      function StatefulPaymentStep() {
        const [paymentMethod, setPaymentMethod] =
          useState<PaymentMethod>('');

        return (
          <PaymentStep
            {...defaultProps}
            merchant={merchant}
            paymentTab="installments"
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
          />
        );
      }

      render(<StatefulPaymentStep />);

      const klumpRadio = screen.getByRole('radio', { name: /klump/i });
      const focusableCount = document.body.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ).length;
      for (
        let tabStop = 0;
        tabStop <= focusableCount && document.activeElement !== klumpRadio;
        tabStop++
      ) {
        await user.tab();
      }

      expect(klumpRadio).toHaveFocus();

      await user.keyboard(' ');

      await waitFor(() => expect(klumpRadio).toBeChecked());
    });

    it('hides installments when no installment options are enabled', () => {
      // Arrange
      const merchant = {
        feature_settings: {
          credpal_enabled: false,
          credit_direct_enabled: false,
          klump_enabled: false,
        } as FeatureSettings,
      };

      // Act
      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
        />
      );

      // Assert
      expect(screen.queryByRole('button', { name: 'Pay in Installments' })).not.toBeInTheDocument();
    });

    it('shows CredPal info when CredPal is selected', () => {
      // Arrange
      const merchant = {
        feature_settings: { credpal_enabled: true } as FeatureSettings,
      };

      // Act
      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          paymentMethod="credpal"
        />
      );

      // Assert
      expect(screen.getByText('How CredPal works')).toBeInTheDocument();
      expect(screen.getByText(/quick approval in minutes/i)).toBeInTheDocument();
    });

    it('shows Credit Direct info when Credit Direct is selected', () => {
      // Arrange
      const merchant = {
        feature_settings: { credit_direct_enabled: true } as FeatureSettings,
      };

      // Act
      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          paymentMethod="credit_direct"
        />
      );

      // Assert
      expect(screen.getByText('How Credit Direct works')).toBeInTheDocument();
      expect(screen.getByText(/instant approval decision/i)).toBeInTheDocument();
    });

    it('shows Klump info when Klump is selected', () => {
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          paymentMethod="klump"
        />
      );

      expect(screen.getByText('How Klump works')).toBeInTheDocument();
      expect(screen.getByText(/complete approval securely/i)).toBeInTheDocument();
    });

    it('calls setPaymentMethod when CredPal is selected', () => {
      // Arrange
      const setPaymentMethod = vi.fn();
      const merchant = {
        feature_settings: { credpal_enabled: true } as FeatureSettings,
      };
      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          setPaymentMethod={setPaymentMethod}
        />
      );

      // Act
      const credpalLabel = screen.getByText('CredPal').closest('label');
      if (credpalLabel) fireEvent.click(credpalLabel);

      // Assert
      expect(setPaymentMethod).toHaveBeenCalledWith('credpal');
    });

    it('calls setPaymentMethod when Klump is selected', () => {
      const setPaymentMethod = vi.fn();
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          setPaymentMethod={setPaymentMethod}
        />
      );

      const klumpLabel = screen.getByText('Klump').closest('label');
      if (klumpLabel) fireEvent.click(klumpLabel);

      expect(setPaymentMethod).toHaveBeenCalledWith('klump');
    });

    it.each([
      [
        'credpal',
        {
          feature_settings: { credpal_enabled: false } as FeatureSettings,
        },
      ],
      [
        'credit_direct',
        {
          feature_settings: {
            credit_direct_enabled: false,
          } as FeatureSettings,
        },
      ],
      [
        'klump',
        {
          feature_settings: {
            klump_enabled: false,
          } as FeatureSettings,
        },
      ],
    ] as const)(
      'clears a stale %s selection when that installment option is unavailable',
      (paymentMethod, merchant) => {
        const setPaymentMethod = vi.fn();

        render(
          <PaymentStep
            {...defaultProps}
            merchant={merchant}
            paymentTab="installments"
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
          />
        );

        expect(setPaymentMethod).toHaveBeenCalledWith('');
      }
    );

    it('clears a stale Klump selection when wallet credit makes it ineligible', () => {
      const setPaymentMethod = vi.fn();
      const merchant = {
        feature_settings: { klump_enabled: true } as FeatureSettings,
      };

      render(
        <PaymentStep
          {...defaultProps}
          merchant={merchant}
          paymentTab="installments"
          paymentMethod="klump"
          setPaymentMethod={setPaymentMethod}
          orderAmount={50_000}
          remainingAmount={45_000}
        />
      );

      expect(setPaymentMethod).toHaveBeenCalledWith('');
    });
  });

  describe('Mobile Place Order Button', () => {
    it('shows place order button on mobile', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} />);

      // Assert
      expect(screen.getByRole('button', { name: /place order/i })).toBeInTheDocument();
    });

    it('shows Generate Invoice button text when payment method is invoice', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} paymentMethod="invoice" />);

      // Assert
      expect(screen.getByRole('button', { name: /generate invoice/i })).toBeInTheDocument();
    });

    it('shows Send Payment Link button text when payment method is payforme', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} paymentMethod="payforme" />);

      // Assert
      expect(screen.getByRole('button', { name: /send payment link/i })).toBeInTheDocument();
    });

    it('disables button when isProcessing is true', () => {
      // Arrange & Act
      const { container } = render(<PaymentStep {...defaultProps} isProcessing={true} />);

      // Assert - button exists but text is replaced with spinner
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
      expect(spinner?.closest('button')).toBeDisabled();
    });

    it('disables button when remainingAmount > 0 and no payment method selected', () => {
      // Arrange & Act
      render(
        <PaymentStep
          {...defaultProps}
          remainingAmount={5000}
          paymentMethod=""
        />
      );

      // Assert
      const button = screen.getByRole('button', { name: /place order/i });
      expect(button).toBeDisabled();
    });

    it('disables button when the selected gateway is no longer available', () => {
      render(
        <PaymentStep
          {...defaultProps}
          merchant={null}
          paymentMethod="paystack"
        />
      );

      const button = screen.getByRole('button', { name: /place order/i });
      expect(button).toBeDisabled();
    });

    it('disables button when a stale installment gateway is selected', () => {
      render(
        <PaymentStep
          {...defaultProps}
          merchant={{
            feature_settings: { credpal_enabled: false } as FeatureSettings,
          }}
          paymentTab="installments"
          paymentMethod="credpal"
        />
      );

      const button = screen.getByRole('button', { name: /place order/i });
      expect(button).toBeDisabled();
    });

    it('disables button when payment method is payforme and isPayForMeValid is false', () => {
      // Arrange & Act
      render(
        <PaymentStep
          {...defaultProps}
          paymentMethod="payforme"
          isPayForMeValid={false}
        />
      );

      // Assert
      const button = screen.getByRole('button', { name: /send payment link/i });
      expect(button).toBeDisabled();
    });

    it('shows loading spinner when isProcessing is true', () => {
      // Arrange & Act
      const { container } = render(<PaymentStep {...defaultProps} isProcessing={true} />);

      // Assert
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('calls handlePlaceOrder when button is clicked', () => {
      // Arrange
      const handlePlaceOrder = vi.fn();
      render(
        <PaymentStep
          {...defaultProps}
          handlePlaceOrder={handlePlaceOrder}
          paymentMethod="paystack"
        />
      );

      // Act
      fireEvent.click(screen.getByRole('button', { name: /place order/i }));

      // Assert
      expect(handlePlaceOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('Newsletter Opt-in', () => {
    it('shows newsletter opt-in checkbox when user is not logged in', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} user={null} />);

      // Assert
      expect(screen.getByText(/email me with exclusive offers/i)).toBeInTheDocument();
    });

    it('does not show newsletter opt-in checkbox when user is logged in', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} user={{ id: 'user-123' }} />);

      // Assert
      expect(screen.queryByText(/email me with exclusive offers/i)).not.toBeInTheDocument();
    });

    it('calls setNewsletterOptIn when checkbox is toggled', () => {
      // Arrange
      const setNewsletterOptIn = vi.fn();
      render(
        <PaymentStep
          {...defaultProps}
          user={null}
          setNewsletterOptIn={setNewsletterOptIn}
        />
      );

      // Act
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // Assert
      expect(setNewsletterOptIn).toHaveBeenCalledWith(true);
    });
  });

  describe('Step Navigation', () => {
    it('allows clicking step header when delivery is completed', () => {
      // Arrange
      const setCurrentStep = vi.fn();
      render(
        <PaymentStep
          {...defaultProps}
          currentStep="delivery"
          completedSteps={{ contact: true, delivery: true }}
          setCurrentStep={setCurrentStep}
        />
      );

      // Act
      const stepButton = screen.getByRole('button', { name: /payment method/i });
      fireEvent.click(stepButton);

      // Assert
      expect(setCurrentStep).toHaveBeenCalledWith('payment');
    });

    it('disables step header button when delivery is not completed', () => {
      // Arrange & Act
      render(
        <PaymentStep
          {...defaultProps}
          currentStep="contact"
          completedSteps={{ contact: false, delivery: false }}
        />
      );

      // Assert
      const stepButton = screen.getByRole('button', { name: /payment method/i });
      expect(stepButton).toBeDisabled();
    });

    it('does not call setCurrentStep when delivery is not completed', () => {
      // Arrange
      const setCurrentStep = vi.fn();
      render(
        <PaymentStep
          {...defaultProps}
          currentStep="contact"
          completedSteps={{ contact: false, delivery: false }}
          setCurrentStep={setCurrentStep}
        />
      );

      // Act
      const stepButton = screen.getByRole('button', { name: /payment method/i });
      fireEvent.click(stepButton);

      // Assert
      expect(setCurrentStep).not.toHaveBeenCalled();
    });
  });

  describe('Payment Method Selection States', () => {
    it('highlights selected payment method with border and background', () => {
      // Arrange & Act
      render(
        <PaymentStep {...defaultProps} paymentMethod="paystack" />
      );

      // Assert
      const paystackLabel = screen.getByText('Paystack').closest('label');
      expect(paystackLabel?.className).toContain('border-store-primary');
      expect(paystackLabel?.className).toContain('bg-store-primary/5');
    });

    it('shows radio button as checked when payment method is selected', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} paymentMethod="paystack" />);

      // Assert
      const paystackRadio = screen.getByRole('radio', { name: /paystack/i });
      expect(paystackRadio).toBeChecked();
    });

    it('shows radio button as unchecked when payment method is not selected', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} paymentMethod="" />);

      // Assert
      const paystackRadio = screen.getByRole('radio', { name: /paystack/i });
      expect(paystackRadio).not.toBeChecked();
    });
  });

  describe('Edge Cases', () => {
    it('handles null merchant gracefully', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} merchant={null} />);

      // Assert
      expect(screen.queryByText('Paystack')).not.toBeInTheDocument();
    });

    it('handles undefined merchant gracefully', () => {
      // Arrange & Act
      render(<PaymentStep {...defaultProps} merchant={undefined} />);

      // Assert
      expect(screen.queryByText('Paystack')).not.toBeInTheDocument();
    });

    it('handles merchant with null feature_settings', () => {
      // Arrange
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: null,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.getByText('Paystack')).toBeInTheDocument();
    });

    it('handles merchant with undefined feature_settings', () => {
      // Arrange
      const merchant = {
        paystack_subaccount_code: 'ACCT_123',
        feature_settings: undefined,
      };

      // Act
      render(<PaymentStep {...defaultProps} merchant={merchant} />);

      // Assert
      expect(screen.getByText('Paystack')).toBeInTheDocument();
    });

    it('handles remainingAmount of 0', () => {
      // Arrange & Act
      render(
        <PaymentStep
          {...defaultProps}
          remainingAmount={0}
          paymentMethod=""
        />
      );

      // Assert
      const button = screen.getByRole('button', { name: /place order/i });
      expect(button).not.toBeDisabled();
    });
  });
});
