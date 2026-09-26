'use client';

import {
  AlertTriangle,
  Box,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { type MouseEvent, useState } from 'react';
import { getDashboardOrderDetailsHref } from '@/app/dashboard/orders/order-links';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import type { Order, ShippingStatus } from './actions';
import { OrderCardDetails } from './order-card-details';
import { getOrderSourceLabel } from './order-source-display';
import { OrderSourceIcon } from './order-source-icon';
import { StatusBadge } from './status-badge';
import { StatusDropdown } from './status-dropdown';

const INTERACTIVE_CARD_TARGET_SELECTOR = [
  'a',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[data-no-card-toggle="true"]',
].join(', ');

export function OrderCard({
  order,
  isSelected,
  onSelect,
  onStatusUpdate,
  onManageJumia,
  jumiaConnectLoading,
  formatCurrency,
}: {
  order: Order;
  isSelected: boolean;
  onSelect: (orderNumber: string, isSelected: boolean) => void;
  onStatusUpdate: (orderNumber: string, newStatus: ShippingStatus) => void;
  onManageJumia?: (order: Order) => void;
  jumiaConnectLoading?: boolean;
  formatCurrency: (amount: number, currency?: string | null) => string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Capture "now" once per mount via the useState initializer: calling
  // Date.now() during render is impure and blocks React Compiler memoization.
  const [renderedAt] = useState(() => Date.now());
  const orderDetailsHref = getDashboardOrderDetailsHref(order);
  const itemCount = order.items?.length || 0;
  const itemLabel = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  const visibleItems = order.items?.slice(0, 4) || [];
  const remainingItems = itemCount > 4 ? itemCount - 4 : 0;
  const orderTime = order.createdAt || new Date(order.date).getTime();
  const hoursAgo = Math.max(
    0,
    Math.floor((renderedAt - orderTime) / (1000 * 60 * 60))
  );
  const isActionable =
    ['Pending', 'Processing'].includes(order.shippingStatus) ||
    ['Unpaid', 'Pending'].includes(order.paymentStatus);
  const isCompleted =
    ['Shipped', 'Delivered', 'Canceled', 'Returned'].includes(
      order.shippingStatus
    ) && ['Paid', 'Refunded'].includes(order.paymentStatus);
  const isUrgent = isActionable && !isCompleted && hoursAgo > 48;
  const isWarning = isActionable && !isCompleted && hoursAgo > 24 && !isUrgent;

  const timeDisplay = (() => {
    if (hoursAgo < 1) return 'Just now';
    if (hoursAgo < 24) return `${hoursAgo} hr${hoursAgo > 1 ? 's' : ''} ago`;
    const days = Math.floor(hoursAgo / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  })();

  const contextLabel = (() => {
    if (['Unpaid', 'Pending'].includes(order.paymentStatus)) {
      return 'Payment Pending';
    }
    if (order.shippingStatus === 'Pending') return 'Unfulfilled';
    if (order.shippingStatus === 'Processing') return 'Processing';
    return 'Attention';
  })();

  const cardStyle = isUrgent
    ? 'dashboard-surface border-l-red-500 ring-1 ring-red-500/15'
    : isWarning
      ? 'dashboard-surface border-l-amber-500 ring-1 ring-amber-500/15'
      : 'dashboard-surface border-l-primary/20';

  const toggleExpanded = () => {
    setIsExpanded((current) => !current);
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;

    if (target instanceof Element) {
      const interactiveTarget = target.closest(
        INTERACTIVE_CARD_TARGET_SELECTOR
      );

      if (interactiveTarget) {
        return;
      }
    }

    toggleExpanded();
  };

  return (
    <Card
      data-testid="order-card"
      data-selected={isSelected ? 'true' : 'false'}
      className={`mb-3 cursor-pointer overflow-hidden rounded-2xl border border-l-4 shadow-sm transition-all hover:shadow-md dark:text-slate-100 ${cardStyle}`}
      onClick={handleCardClick}
    >
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <Checkbox
            onCheckedChange={(checked) =>
              onSelect(order.orderNumber, checked as boolean)
            }
            checked={isSelected}
            className="mt-1 shrink-0"
            aria-label={`Select order ${order.orderNumber}`}
          />
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              {orderDetailsHref ? (
                <Link
                  href={orderDetailsHref}
                  className="font-semibold text-foreground underline-offset-4 hover:underline dark:text-slate-100"
                  onClick={(event) => event.stopPropagation()}
                >
                  {order.customerName}
                </Link>
              ) : (
                <span className="font-semibold text-foreground dark:text-slate-100">
                  {order.customerName}
                </span>
              )}
              <span className="text-muted-foreground">•</span>
              <button
                type="button"
                className="dashboard-surface-subtle cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={toggleExpanded}
              >
                {order.orderNumber}
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground dark:text-slate-400">
                <OrderSourceIcon source={order.source} />
                <span>{getOrderSourceLabel(order.source)}</span>
              </span>
              <span className="text-xs text-muted-foreground dark:text-slate-400">
                {order.date}
              </span>
              <div
                className={`ml-2 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                  isUrgent
                    ? 'border-red-400/45 bg-red-950/70 text-red-100'
                    : isWarning
                      ? 'border-amber-400/45 bg-amber-950/70 text-amber-100'
                      : 'dashboard-surface-subtle border-border text-muted-foreground'
                }`}
              >
                {isActionable && (isUrgent || isWarning) && (
                  <span className="mr-1 font-semibold">{contextLabel}</span>
                )}
                {isUrgent ? (
                  <AlertTriangle className="size-3" />
                ) : isWarning ? (
                  <Clock className="size-3" />
                ) : (
                  <Clock className="size-3 opacity-50" />
                )}
                {timeDisplay}
              </div>
            </div>

            <div className="mb-1 hidden items-center gap-2 md:flex">
              {visibleItems.length > 0 ? (
                visibleItems.map((item) => (
                  <div
                    key={item.id}
                    className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted dark:border-slate-800 dark:bg-slate-900"
                  >
                    {item.image ? (
                      <Image
                        src={item.image}
                        alt={item.name}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    ) : (
                      <Box className="size-5 text-muted-foreground/50" />
                    )}
                    {item.quantity > 1 && (
                      <div className="absolute -bottom-1 -right-1 rounded-full bg-foreground px-1 py-0.5 text-[10px] font-bold text-background shadow-sm">
                        x{item.quantity}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <span className="text-sm italic text-muted-foreground">
                  No items found
                </span>
              )}

              {remainingItems > 0 && (
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 text-xs font-medium text-muted-foreground dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
                  +{remainingItems}
                </div>
              )}
            </div>

            <p className="mt-1 max-w-[90%] truncate text-xs text-muted-foreground dark:text-slate-400">
              {itemLabel}: {order.items?.map((item) => item.name).join(', ')}
            </p>
          </div>
        </div>

        <div className="mt-2 flex w-full items-center justify-between gap-6 border-t pt-3 md:mt-0 md:w-auto md:justify-end md:border-t-0 md:pt-0">
          <div className="flex min-w-[100px] flex-col items-end">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-slate-500">
              Total
            </span>
            <span className="text-lg font-bold dark:text-slate-50">
              {formatCurrency(order.total, order.currency)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex md:items-center">
              <StatusBadge status={order.paymentStatus} type="payment" />
            </div>

            {order.source === 'jumia' ? (
              <Button
                size="sm"
                variant="outline"
                className="border-orange-200 hover:bg-orange-50 hover:text-orange-600 dark:border-orange-500/30 dark:hover:bg-orange-500/10"
                disabled={jumiaConnectLoading}
                onClick={(event) => {
                  event.stopPropagation();
                  onManageJumia?.(order);
                }}
                data-no-card-toggle="true"
              >
                {jumiaConnectLoading ? 'Loading...' : 'Manage Jumia Order'}
              </Button>
            ) : (
              <StatusDropdown order={order} onStatusUpdate={onStatusUpdate} />
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleExpanded}
              className="size-9 shrink-0 rounded-lg"
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for order ${order.orderNumber}`}
              data-no-card-toggle="true"
            >
              {isExpanded ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <OrderCardDetails order={order} formatCurrency={formatCurrency} />
      )}
    </Card>
  );
}
