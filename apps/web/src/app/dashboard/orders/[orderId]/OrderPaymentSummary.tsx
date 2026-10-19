import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { Order } from '../actions';

interface OrderPaymentSummaryProps {
  order: Pick<
    Order,
    | 'currency'
    | 'discount_amount'
    | 'gift_wrapping_fee'
    | 'paymentMethod'
    | 'payment_reference'
    | 'shipping_fee'
    | 'subtotal'
    | 'tax_amount'
    | 'tax_basis'
    | 'total'
  >;
}

function formatCurrency(amount: number, currency?: string | null): string {
  return formatDisplayCurrency(amount, currency || 'NGN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function normalizeAmount(amount: number | undefined, fallback = 0) {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? Math.max(0, amount)
    : fallback;
}

export function OrderPaymentSummary({ order }: OrderPaymentSummaryProps) {
  const orderCurrency = order.currency || 'NGN';
  const shippingFee = normalizeAmount(order.shipping_fee);
  const giftWrappingFee = normalizeAmount(order.gift_wrapping_fee);
  const taxes = normalizeAmount(order.tax_amount);
  const discountAmount = normalizeAmount(order.discount_amount);
  const taxesIncluded = order.tax_basis === 'inclusive';
  const taxesExcluded = order.tax_basis === 'exclusive';
  const taxLabel = taxesIncluded
    ? 'Taxes (included)'
    : order.tax_basis == null
      ? 'Taxes (unclassified)'
      : 'Taxes';
  const subtotal = normalizeAmount(
    order.subtotal,
    Math.max(
      0,
      order.total -
        shippingFee -
        giftWrappingFee -
        (taxesExcluded ? taxes : 0) +
        discountAmount
    )
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Payment Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between">
          <span>Subtotal</span>{' '}
          <span>{formatCurrency(subtotal, orderCurrency)}</span>
        </div>
        {order.paymentMethod && (
          <div className="flex justify-between">
            <span>Payment Method</span>{' '}
            <span className="capitalize">{order.paymentMethod}</span>
          </div>
        )}
        {order.payment_reference && (
          <div className="flex justify-between">
            <span>Payment Reference</span>{' '}
            <span className="font-mono text-xs">{order.payment_reference}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Shipping Fee</span>{' '}
          <span>{formatCurrency(shippingFee, orderCurrency)}</span>
        </div>
        {giftWrappingFee > 0 && (
          <div className="flex justify-between">
            <span>Gift Wrapping</span>{' '}
            <span>{formatCurrency(giftWrappingFee, orderCurrency)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>{taxLabel}</span>{' '}
          <span>{formatCurrency(taxes, orderCurrency)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Discount</span>{' '}
            <span>-{formatCurrency(discountAmount, orderCurrency)}</span>
          </div>
        )}
        <Separator />
        <div className="flex justify-between font-bold text-lg">
          <span>Total Amount</span>{' '}
          <span>{formatCurrency(order.total, orderCurrency)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
