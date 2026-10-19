'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PAYMENT_VARIANTS: Record<string, string> = {
  Paid: 'bg-green-100 text-green-800 border-green-200',
  Unpaid: 'bg-red-100 text-red-800 border-red-200',
  Pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Partially Paid': 'bg-blue-100 text-blue-800 border-blue-200',
  Refunded: 'bg-gray-100 text-gray-800 border-gray-200',
};

const SHIPPING_VARIANTS: Record<string, string> = {
  Pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Processing: 'bg-blue-100 text-blue-800 border-blue-200',
  Shipped: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  Delivered: 'bg-green-100 text-green-800 border-green-200',
  Canceled: 'bg-red-100 text-red-800 border-red-200',
  Cancelled: 'bg-red-100 text-red-800 border-red-200',
  Returned: 'bg-purple-100 text-purple-800 border-purple-200',
};

export function StatusBadge({
  status,
  type,
}: {
  status: string;
  type: 'payment' | 'shipping';
}) {
  const className =
    type === 'payment' ? PAYMENT_VARIANTS[status] : SHIPPING_VARIANTS[status];

  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-full border px-3 text-sm font-medium capitalize',
        type === 'payment'
          ? 'h-9 min-w-[124px] px-3 text-sm'
          : 'h-7 min-w-[104px] px-3 text-xs',
        className
      )}
    >
      {status}
    </Badge>
  );
}
