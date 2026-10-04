import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { ReceiptListItem } from '@/types/receipt';
import { formatPrice, ReceiptCard } from './ReceiptCard';

jest.mock('@react-native-vector-icons/ionicons', () => () => null);

jest.mock('expo-image', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    Image: ({
      autoplay,
      accessibilityLabel,
      testID,
    }: {
      autoplay?: boolean;
      accessibilityLabel?: string;
      testID?: string;
    }) => {
      const viewProps = {
        testID: testID ?? 'receipt-product-image',
        autoplay,
        accessible: true,
        accessibilityRole: 'image',
        accessibilityLabel,
      } as unknown as React.ComponentProps<typeof View>;
      return <View {...viewProps} />;
    },
  };
});

const receiptItem: ReceiptListItem = {
  id: 'order-1',
  order_number: 'ORD-100',
  payment_status: 'paid',
  total: 150000,
  amount_paid: 150000,
  currency: 'NGN',
  created_at: '2026-08-01T12:00:00.000Z',
  invoice_issue_date: null,
  transaction_date: '2026-07-16T00:30:00.000Z',
  items: [
    {
      id: 'item-1',
      product_name: 'Test Phone',
      quantity: 1,
      price: 150000,
      image_url: 'https://example.com/phone.gif',
    },
  ],
};

describe('ReceiptCard', () => {
  it('badges a covered manual balance as a receipt under a non-paid label', () => {
    // The preview promotes covered manual balances to receipts, so the
    // card must agree — never "View Invoice" into a receipt artifact.
    render(
      <ReceiptCard
        item={{
          ...receiptItem,
          payment_status: 'pending',
          document_kind: 'receipt',
        }}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Receipt')).toBeTruthy();
    expect(screen.getByText('View Receipt')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
  });

  it('falls back to the raw status when the effective kind is absent', () => {
    render(
      <ReceiptCard
        item={{ ...receiptItem, payment_status: 'pending' }}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Invoice')).toBeTruthy();
  });

  it('honors an explicit invoice kind under a paid label', () => {
    // An invalid manual row (cancelled, underfunded) keeps the paid label
    // but opens an invoice in the preview, so the card must badge invoice
    // instead of "View Receipt" into an invoice.
    render(
      <ReceiptCard
        item={{
          ...receiptItem,
          payment_status: 'paid',
          document_kind: 'invoice',
        }}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Invoice')).toBeTruthy();
    expect(screen.getByText('View Invoice')).toBeTruthy();
    expect(screen.queryByText('View Receipt')).toBeNull();
    // Badge says invoice, but the ledger says paid — the money label
    // must not misstate payment state as an unpaid Total.
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.queryByText('Total')).toBeNull();
    // The mixed signal gets an explanatory subtitle: no receipt exists.
    expect(
      screen.getByText('Payment recorded \u2014 invoice only, no receipt')
    ).toBeTruthy();
    // VoiceOver hears the badge kind with the money state sighted users
    // see, including the invoice-only explainer.
    expect(
      screen.getByLabelText(/Invoice for .* Paid .* invoice only, no receipt/)
    ).toBeTruthy();
  });

  it('honors an explicit invoice kind under a legacy-cased paid label', () => {
    // Legacy Paid/PAID labels normalize like the list paid-shortcut: the
    // badge still says Invoice, but the money line reads Paid with the
    // invoice-only explainer instead of an unpaid Total.
    render(
      <ReceiptCard
        item={{
          ...receiptItem,
          payment_status: 'PAID',
          document_kind: 'invoice',
        }}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Invoice')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.queryByText('Total')).toBeNull();
    expect(
      screen.getByText('Payment recorded \u2014 invoice only, no receipt')
    ).toBeTruthy();
  });

  it('hides the balance on corrupt totals instead of printing NGN 0', () => {
    render(
      <ReceiptCard
        item={{
          ...receiptItem,
          payment_status: 'partially_paid',
          document_kind: 'invoice',
          total: Number.NaN,
        }}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.queryByText(/Balance:/)).toBeNull();
    expect(screen.getByLabelText(/ for Test Phone, /)).toBeTruthy();
    expect(screen.queryByLabelText(/balance/)).toBeNull();
  });

  it('fails a stale manual receipt kind closed to invoice on terminal shipping', () => {
    // A cached entry can outlive a cancellation: the list-time kind says
    // receipt, but the card re-verifies through the promotion gate and
    // badges invoice like the preview opens.
    render(
      <ReceiptCard
        item={{
          ...receiptItem,
          recorded_by_user_id: 'staff-1',
          import_job_id: null,
          external_source: null,
          payment_status: 'paid',
          shipping_status: 'cancelled',
          subtotal: 150000,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          document_kind: 'receipt',
        }}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Invoice')).toBeTruthy();
    expect(screen.getByText('View Invoice')).toBeTruthy();
    expect(screen.queryByText('View Receipt')).toBeNull();
  });

  it('renders the receipt product title', () => {
    render(
      <ReceiptCard
        item={receiptItem}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText('Test Phone')).toBeTruthy();
  });

  it('renders the selected transaction date when it differs from creation', () => {
    render(
      <ReceiptCard
        item={receiptItem}
        colors={Colors.light}
        onPress={jest.fn()}
      />
    );

    expect(screen.getByText(/16 Jul 2026/)).toBeTruthy();
  });

  it('degrades malformed currencies to NGN instead of crashing', () => {
    // Legacy rows can carry codes the sender would skip; Intl throws
    // RangeError for them, which must not crash the list render.
    for (const currency of ['NAIRA', '', 'ZZZ']) {
      const { unmount } = render(
        <ReceiptCard
          item={{ ...receiptItem, currency }}
          colors={Colors.light}
          onPress={jest.fn()}
        />
      );
      expect(screen.getByText(/150,000/)).toBeTruthy();
      unmount();
    }
    expect(formatPrice(150000, 'NAIRA')).toBe(formatPrice(150000, 'NGN'));
    expect(formatPrice(150000, '')).toBe(formatPrice(150000, 'NGN'));
    // The fallback caches under the bad key: repeat renders rethrow nothing.
    expect(formatPrice(150000, 'NAIRA')).toBe(formatPrice(150000, 'NGN'));
  });

  it('degrades non-finite prices to zero instead of NaN currency', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatPrice(bad, 'USD')).toBe(formatPrice(0, 'NGN'));
      expect(formatPrice(bad, 'USD')).not.toMatch(/NaN|Infinity/);
    }
  });

  describe('bugfix: animated order product images on receipts', () => {
    it('falls back to NGN pricing on null currency', () => {
      render(
        <ReceiptCard
          item={{ ...receiptItem, currency: null }}
          colors={Colors.light}
          onPress={jest.fn()}
        />
      );

      expect(screen.getByText(/150,000/)).toBeTruthy();
    });

    it('does not autoplay product thumbnail images', () => {
      render(
        <ReceiptCard
          item={receiptItem}
          colors={Colors.light}
          onPress={jest.fn()}
        />
      );

      expect(
        screen.getByRole('image', { name: 'Test Phone' }).props.autoplay
      ).toBe(false);
    });
  });
});
