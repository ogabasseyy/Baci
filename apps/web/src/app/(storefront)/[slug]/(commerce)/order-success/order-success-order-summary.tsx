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
    <div className="text-left bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-100">
      <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-500">Order Number</span>
        <span className="font-bold text-gray-900">
          #{order.order_number || order.id.slice(0, 8)}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-start">
          <span className="text-sm font-medium text-gray-500">
            Items ({order.items?.length || 0})
          </span>
          <span className="font-medium text-gray-900">
            {formatCurrency(order.total)}
          </span>
        </div>
        {order.customer_email && (
          <div className="flex justify-between items-start">
            <span className="text-sm font-medium text-gray-500">Email</span>
            <span className="font-medium text-gray-900 truncate max-w-[200px]">
              {order.customer_email}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
