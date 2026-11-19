import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscountResult } from '@/components/storefront/checkout/discount-code-input';
import type { CheckoutScreenProps } from './CheckoutScreen';

const screenMocks = vi.hoisted(() => ({ captureSteps: vi.fn() }));

vi.mock('@/components/storefront/checkout/discount-code-input', () => ({
  DiscountCodeInput: (props: {
    appliedDiscount?: DiscountResult | null;
    cartTotal: number;
    currencyCountryCode?: string | null;
    merchantId: string;
    onApply: (value: DiscountResult) => void;
    onRemove: () => void;
    payoutCurrency?: string | null;
    productIds?: string[];
  }) => (
    <section
      data-testid="discount"
      data-merchant={props.merchantId}
      data-total={props.cartTotal}
      data-country={props.currencyCountryCode}
      data-payout={props.payoutCurrency}
      data-products={props.productIds?.join(',')}
      data-applied={props.appliedDiscount?.code}
    >
      <button
        type="button"
        onClick={() =>
          props.onApply({
            valid: true,
            code: 'SAVE',
            discount_type: 'fixed',
            discount_value: 500,
          })
        }
      >
        Apply discount
      </button>
      <button type="button" onClick={props.onRemove}>
        Remove discount
      </button>
    </section>
  ),
}));
vi.mock(
  '@/components/storefront/ogabassey/components/MobileCheckoutComponents',
  () => ({
    MobileOrderSummary: (props: {
      remainingAmount: number;
      taxAmount?: number;
      walletBalance?: number;
      setPayWithWallet?: (value: boolean) => void;
    }) => (
      <div
        data-testid="mobile-summary"
        data-remaining={props.remainingAmount}
        data-tax={props.taxAmount}
        data-wallet={props.walletBalance}
      >
        <button type="button" onClick={() => props.setPayWithWallet?.(true)}>
          Use wallet
        </button>
      </div>
    ),
  })
);
vi.mock('./DeferredCheckoutAuthModal', () => ({
  DeferredCheckoutAuthModal: (props: {
    isOpen: boolean;
    onSuccess: () => void;
  }) =>
    props.isOpen ? (
      <div role="dialog">
        <button type="button" onClick={props.onSuccess}>
          Auth success
        </button>
      </div>
    ) : null,
}));
vi.mock('./CheckoutPaymentSessionOverlays', () => ({
  CheckoutPaymentSessionOverlays: (
    props: CheckoutScreenProps['overlays'] & { merchantName?: string | null }
  ) => (
    <section
      data-testid="payment-overlays"
      data-merchant={props.merchantName ?? ''}
    >
      {props.walletFundedTransfer.error && (
        <p role="alert">{props.walletFundedTransfer.error}</p>
      )}
      <button type="button" onClick={props.dva.onConfirmTransfer}>
        Confirm transfer
      </button>
      <button type="button" onClick={props.dva.onClose}>
        Close transfer
      </button>
    </section>
  ),
}));
vi.mock('./CheckoutStepComposition', () => ({
  CheckoutStepComposition: (props: {
    session: CheckoutScreenProps['steps'];
  }) => {
    screenMocks.captureSteps(props.session);
    return (
      <section data-testid="steps">
        <button type="button" onClick={props.session.onSignIn}>
          Sign in
        </button>
      </section>
    );
  },
}));
vi.mock('./DesktopOrderSummary', () => ({
  DesktopOrderSummary: (props: { summarySubtotal: number }) => (
    <aside
      data-testid="desktop-summary"
      data-subtotal={props.summarySubtotal}
    />
  ),
}));

import { CheckoutScreen } from './CheckoutScreen';

import {
  createProps,
  onAuthSuccess,
  onCloseTransfer,
  onConfirmTransfer,
  onDiscountApplied,
  onSignIn,
} from './CheckoutScreen-summary.test-support';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CheckoutScreen summaries', () => {
  it('maps mobile and desktop summaries and forwards discount actions', () => {
    const props = createProps();
    render(<CheckoutScreen {...props} />);

    expect(screen.getByTestId('mobile-summary')).toHaveAttribute(
      'data-remaining',
      '9000'
    );
    expect(screen.getByTestId('desktop-summary')).toHaveAttribute(
      'data-subtotal',
      '10000'
    );
    expect(screen.getByTestId('discount')).toHaveAttribute(
      'data-merchant',
      'merchant-1'
    );
    expect(screen.getByTestId('discount')).toHaveAttribute(
      'data-total',
      '10000'
    );
    expect(screen.getByTestId('discount')).toHaveAttribute(
      'data-country',
      'NG'
    );
    expect(screen.getByTestId('discount')).toHaveAttribute(
      'data-payout',
      'NGN'
    );
    expect(screen.getByTestId('discount')).toHaveAttribute(
      'data-products',
      'product-1'
    );
    expect(screen.getByTestId('discount')).toHaveAttribute(
      'data-applied',
      'WELCOME'
    );
    expect(screenMocks.captureSteps).toHaveBeenCalledWith(props.steps);
    fireEvent.click(screen.getByRole('button', { name: 'Apply discount' }));
    expect(onDiscountApplied).toHaveBeenCalledWith({
      valid: true,
      code: 'SAVE',
      discount_type: 'fixed',
      discount_value: 500,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove discount' }));
    expect(onDiscountApplied).toHaveBeenLastCalledWith(null);
  });

  it('shows the responsive desktop summary while omitting hidden mobile summary and resumed discount', () => {
    render(
      <CheckoutScreen
        {...createProps({ showMobile: false, discountVisible: false })}
      />
    );

    expect(screen.queryByTestId('mobile-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('desktop-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('discount')).not.toBeInTheDocument();
  });

  it('forwards tax and wallet controls to the mobile summary', () => {
    const props = createProps();
    const setPayWithWallet = vi.fn();
    Object.assign(props.summary.presentation.mobile, {
      taxAmount: 525,
      walletBalance: 500,
      setPayWithWallet,
    });
    render(<CheckoutScreen {...props} />);
    expect(screen.getByTestId('mobile-summary')).toHaveAttribute(
      'data-tax',
      '525'
    );
    expect(screen.getByTestId('mobile-summary')).toHaveAttribute(
      'data-wallet',
      '500'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use wallet' }));
    expect(setPayWithWallet).toHaveBeenCalledWith(true);
  });

  it('places the dedicated mobile and desktop Oxygen summaries around the steps', () => {
    render(
      <CheckoutScreen
        {...createProps()}
        oxygenStep={<div data-testid="oxygen-step" />}
        oxygenMobileSummary={<div data-testid="oxygen-mobile" />}
        oxygenSummary={<div data-testid="oxygen-desktop" />}
      />
    );
    const step = screen.getByTestId('oxygen-step');
    const grid = step.closest('.grid');
    expect(grid).toHaveClass('lg:grid-cols-12');
    expect(grid).toContainElement(screen.getByTestId('oxygen-desktop'));
    expect(
      screen.getByTestId('oxygen-mobile').compareDocumentPosition(step) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      step.compareDocumentPosition(screen.getByTestId('oxygen-desktop')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders the desktop Oxygen summary once when no separate mobile summary exists', () => {
    render(
      <CheckoutScreen
        {...createProps()}
        oxygenStep={<div data-testid="oxygen-step" />}
        oxygenSummary={<div data-testid="oxygen-summary" />}
      />
    );
    expect(screen.getAllByTestId('oxygen-summary')).toHaveLength(1);
  });

  it('opens the auth prompt from checkout steps and renders the open auth dialog', () => {
    render(<CheckoutScreen {...createProps({ authOpen: true })} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Auth success' }));
    expect(onAuthSuccess).toHaveBeenCalledOnce();
  });

  it('passes payment overlay controls through so transfer confirmation and close callbacks run', () => {
    render(<CheckoutScreen {...createProps()} />);

    expect(screen.getByTestId('payment-overlays')).toHaveAttribute(
      'data-merchant',
      'Ada Store'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not verify transfer'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close transfer' }));
    expect(onConfirmTransfer).toHaveBeenCalledOnce();
    expect(onCloseTransfer).toHaveBeenCalledOnce();
  });
});
