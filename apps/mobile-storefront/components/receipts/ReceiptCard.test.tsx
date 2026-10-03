import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { ReceiptListItem } from '@/types/receipt';
import { ReceiptCard } from './ReceiptCard';

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
