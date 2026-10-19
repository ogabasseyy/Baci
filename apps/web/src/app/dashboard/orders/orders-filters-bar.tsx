'use client';

import {
  AlertCircle as AlertCircleIcon,
  CheckCircle,
  ChevronDown,
  CircleDot,
  Clock,
  CreditCard,
  Hourglass,
  List,
  ListFilter,
  RefreshCw,
  RotateCcw,
  Search,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import type { ElementType } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  PAYMENT_STATUSES,
  type PaymentStatus,
  SHIPPING_STATUSES,
  type ShippingStatus,
} from './order-statuses';

const PAYMENT_STATUS_ICONS: Record<PaymentStatus, ElementType> = {
  Paid: CheckCircle,
  Unpaid: AlertCircleIcon,
  Pending: Hourglass,
  'Partially Paid': CircleDot,
  Refunded: Undo2,
  'Bnpl Approved': CreditCard,
};

const SHIPPING_STATUS_ICONS: Record<ShippingStatus, ElementType> = {
  Pending: Clock,
  Processing: RefreshCw,
  Shipped: Truck,
  Delivered: CheckCircle,
  Canceled: X,
  Cancelled: X,
  Returned: RotateCcw,
};

export function OrdersFiltersBar({
  searchTerm,
  onSearchChange,
  paymentFilter,
  onPaymentFilterChange,
  shippingFilter,
  onShippingFilterChange,
}: {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  paymentFilter: PaymentStatus | 'All';
  onPaymentFilterChange: (value: PaymentStatus | 'All') => void;
  shippingFilter: ShippingStatus | 'All';
  onShippingFilterChange: (value: ShippingStatus | 'All') => void;
}) {
  return (
    <>
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search orders..."
          aria-label="Search orders"
          className="w-full bg-background/50 pl-8 backdrop-blur-xs"
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <ListFilter className="size-4 text-blue-800" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="gap-1 border-blue-200 bg-blue-50/50 text-blue-800 hover:bg-blue-100 hover:text-blue-900"
            >
              <CreditCard className="size-4" />
              <span>
                {paymentFilter === 'All' ? 'Payment Status' : paymentFilter}
              </span>
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem
              checked={paymentFilter === 'All'}
              onCheckedChange={() => onPaymentFilterChange('All')}
              className="text-blue-800"
            >
              <List className="mr-2 size-4" />
              All
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {PAYMENT_STATUSES.map((status) => {
              const Icon = PAYMENT_STATUS_ICONS[status];

              return (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={paymentFilter === status}
                  onCheckedChange={() => onPaymentFilterChange(status)}
                  className="text-blue-800"
                >
                  <Icon className="mr-2 size-4" />
                  {status}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="gap-1 border-blue-200 bg-blue-50/50 text-blue-800 hover:bg-blue-100 hover:text-blue-900"
            >
              <Truck className="size-4" />
              <span>
                {shippingFilter === 'All' ? 'Shipping Status' : shippingFilter}
              </span>
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem
              checked={shippingFilter === 'All'}
              onCheckedChange={() => onShippingFilterChange('All')}
              className="text-blue-800"
            >
              <List className="mr-2 size-4" />
              All
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {SHIPPING_STATUSES.map((status) => {
              const Icon = SHIPPING_STATUS_ICONS[status];

              return (
                <DropdownMenuCheckboxItem
                  key={status}
                  checked={shippingFilter === status}
                  onCheckedChange={() => onShippingFilterChange(status)}
                  className="text-blue-800"
                >
                  <Icon className="mr-2 size-4" />
                  {status}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
