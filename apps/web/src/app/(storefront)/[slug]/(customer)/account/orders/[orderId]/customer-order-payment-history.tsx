import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { StorefrontTransaction } from '@/types/storefront-order';

interface CustomerOrderPaymentHistoryProps {
  transactions?: StorefrontTransaction[];
  currency: string;
}

function formatAccountDate(value: string) {
  return new Date(value).toLocaleDateString('en-US');
}

/**
 * Customer payment-history card. Extracted from
 * customer-order-details-content.tsx (300-line file limit). Renders nothing
 * when the order has no recorded transactions.
 */
export function CustomerOrderPaymentHistory({
  transactions,
  currency,
}: CustomerOrderPaymentHistoryProps) {
  if (!transactions || transactions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {transactions.map((transaction, index) => (
          <div
            key={transaction.id || `${transaction.created_at}-${index}`}
            className="flex justify-between gap-4"
          >
            <div>
              <p className="font-medium">
                {transaction.metadata?.payment_method ||
                  transaction.description ||
                  'Payment'}
              </p>
              <p className="text-muted-foreground">
                {formatAccountDate(transaction.created_at)}
              </p>
            </div>
            <p className="font-medium">
              {formatDisplayCurrency(transaction.amount, currency)}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
