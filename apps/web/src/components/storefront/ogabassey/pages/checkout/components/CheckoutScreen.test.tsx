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
    MobileOrderSummary: (props: { remainingAmount: number }) => (
      <div
        data-testid="mobile-summary"
        data-remaining={props.remainingAmount}
      />
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

const onConfirmTransfer = vi.fn();
const onCloseTransfer = vi.fn();
const onAuthSuccess = vi.fn();
const onDiscountApplied = vi.fn();
const onSignIn = vi.fn();
const appliedDiscount: DiscountResult = {
  valid: true,
  code: 'WELCOME',
  discount_type: 'percentage',
  discount_value: 10,
};

function createProps({
  showMobile = true,
  discountVisible = true,
  authOpen = false,
}: {
  showMobile?: boolean;
  discountVisible?: boolean;
  authOpen?: boolean;
} = {}): CheckoutScreenProps {
  return {
    page: {
      onReturnToCart: vi.fn(),
      merchantName: 'Ada Store',
      formatCurrency: (amount) => `₦${amount}`,
    },
    auth: { isOpen: authOpen, onOpenChange: vi.fn(), onSuccess: onAuthSuccess },
    overlays: {
      crypto: {} as CheckoutScreenProps['overlays']['crypto'],
      walletFundedTransfer: {
        error: 'Could not verify transfer',
      } as CheckoutScreenProps['overlays']['walletFundedTransfer'],
      dva: {
        data: {
          account_number: '1234567890',
        } as CheckoutScreenProps['overlays']['dva']['data'],
        isVerifying: false,
        onClose: onCloseTransfer,
        onConfirmTransfer,
      },
    },
    summary: {
      presentation: {
        showMobile,
        mobile: {
          remainingAmount: 9000,
        } as CheckoutScreenProps['summary']['presentation']['mobile'],
        desktop: {
          summarySubtotal: 10000,
        } as CheckoutScreenProps['summary']['presentation']['desktop'],
        discount: {
          visible: discountVisible,
          merchantId: 'merchant-1',
          cartTotal: 10000,
          currencyCountryCode: 'NG',
          payoutCurrency: 'NGN',
          productIds: ['product-1'],
        },
      },
      payment: {
        discount: { applied: appliedDiscount, setApplied: onDiscountApplied },
      } as unknown as CheckoutScreenProps['summary']['payment'],
    },
    steps: { onSignIn } as unknown as CheckoutScreenProps['steps'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CheckoutScreen', () => {
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
