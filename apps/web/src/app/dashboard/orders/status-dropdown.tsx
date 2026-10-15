'use client';

import {
  CheckCircle,
  ChevronDown,
  PackageCheck,
  RefreshCw,
  Truck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Order } from './actions';
import type { ShippingStatus } from './order-statuses';
import { StatusBadge } from './status-badge';

export function StatusDropdown({
  order,
  onStatusUpdate,
}: {
  order: Order;
  onStatusUpdate: (orderNumber: string, newStatus: ShippingStatus) => void;
}) {
  const { shippingStatus } = order;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-lg capitalize"
          data-no-card-toggle="true"
        >
          <StatusBadge status={shippingStatus} type="shipping" />
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {shippingStatus === 'Pending' && (
          <DropdownMenuItem
            onSelect={() => onStatusUpdate(order.orderNumber, 'Processing')}
          >
            <CheckCircle className="mr-2 size-4" />
            <span>Confirm Order</span>
          </DropdownMenuItem>
        )}
        {shippingStatus === 'Processing' && (
          <DropdownMenuItem
            onSelect={() => onStatusUpdate(order.orderNumber, 'Shipped')}
          >
            <Truck className="mr-2 size-4" />
            <span>Ship Order</span>
          </DropdownMenuItem>
        )}
        {shippingStatus === 'Shipped' && (
          <DropdownMenuItem
            onSelect={() => onStatusUpdate(order.orderNumber, 'Delivered')}
          >
            <PackageCheck className="mr-2 size-4" />
            <span>Mark as Delivered</span>
          </DropdownMenuItem>
        )}
        {shippingStatus === 'Delivered' && (
          <DropdownMenuItem
            onSelect={() => onStatusUpdate(order.orderNumber, 'Returned')}
          >
            <RefreshCw className="mr-2 size-4" />
            <span>Process Return</span>
          </DropdownMenuItem>
        )}
        {(shippingStatus === 'Pending' || shippingStatus === 'Processing') && (
          <DropdownMenuItem
            onSelect={() => onStatusUpdate(order.orderNumber, 'Canceled')}
            className="text-red-600 focus:bg-red-50 focus:text-red-600"
          >
            <X className="mr-2 size-4" />
            <span>Cancel Order</span>
          </DropdownMenuItem>
        )}
        {(shippingStatus === 'Canceled' ||
          shippingStatus === 'Cancelled' ||
          shippingStatus === 'Returned') && (
          <DropdownMenuItem disabled>No actions available</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
