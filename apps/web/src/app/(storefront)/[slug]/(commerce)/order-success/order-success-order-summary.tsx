import type { StorefrontOrderData as OrderData } from './fetch-storefront-order';

/** Order summary card: number, item count/total, and buyer email. */
export function OrderSuccessOrderSummary({
  formatCurrency,
  order,
}: {
  formatCurrency: (amount: number) => string;
  order: OrderData;
}) {
  return (
    <div className="text-left bg-store-secondary rounded-2xl p-6 mb-8 border border-store-border">
      <div className="flex justify-between items-center mb-4 pb-4 border-b border-store-border">
        <span className="text-sm font-medium text-store-secondary-text/60">
          Order Number
        </span>
        <span className="font-bold text-store-secondary-text">
          #{order.order_number || order.id.slice(0, 8)}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-start">
          <span className="text-sm font-medium text-store-secondary-text/60">
            Items ({order.items?.length || 0})
          </span>
          <span className="font-medium text-store-secondary-text">
            {formatCurrency(order.total)}
          </span>
        </div>
        {order.customer_email && (
          <div className="flex justify-between items-start">
            <span className="text-sm font-medium text-store-secondary-text/60">
              Email
            </span>
            <span className="font-medium text-store-secondary-text truncate max-w-[200px]">
              {order.customer_email}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
