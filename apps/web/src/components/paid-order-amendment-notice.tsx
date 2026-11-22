import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { PaidOrderAmendmentStatus } from '@/schemas/order-amendment-document';

export function PaidOrderAmendmentNotice({
  amendment,
  currency,
}: {
  amendment: PaidOrderAmendmentStatus;
  currency: string;
}) {
  const { state } = amendment;
  const money = (minor: number) => formatDisplayCurrency(minor / 100, currency);
  return (
    <Alert>
      <AlertTitle>
        {state === 'reversed'
          ? 'Item change reversed'
          : state === 'cancelled_for_recovery'
            ? 'Order cancelled'
            : 'Order items updated'}
      </AlertTitle>
      <AlertDescription>
        {state === 'awaiting_payment' &&
          `Balance due ${money(amendment.balanceDueMinor)}. Contact the store for payment instructions.`}
        {state === 'awaiting_refund' &&
          'Contact the store for an update on your refund.'}
        {state === 'settled' &&
          'The updated items and total are shown on this order.'}
        {state === 'reversed' && 'Your original items have been restored.'}
        {state === 'cancelled_for_recovery' &&
          'Contact the store for repayment details.'}
        {amendment.holdFulfillment && ' Fulfillment is on hold.'}
      </AlertDescription>
    </Alert>
  );
}
