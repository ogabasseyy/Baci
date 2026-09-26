'use client';

import { Box, MapPin } from 'lucide-react';
import Link from 'next/link';
import { getDashboardOrderDetailsHref } from '@/app/dashboard/orders/order-links';
import { Button } from '@/components/ui/button';
import type { Order } from './actions';
import { StatusBadge } from './status-badge';

export function OrderCardDetails({
  order,
  formatCurrency,
}: {
  order: Order;
  formatCurrency: (amount: number, currency?: string | null) => string;
}) {
  const orderDetailsHref = getDashboardOrderDetailsHref(order);

  return (
    <div className="dashboard-surface-subtle animate-in slide-in-from-top-2 border-t p-4">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Box className="size-3" /> Item Details
          </h4>
          <div className="space-y-2">
            {order.items?.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded p-2 text-sm hover:bg-muted/20"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                    <Box className="size-4 text-muted-foreground/40" />
                  </div>
                  <div className="truncate">
                    <p className="truncate font-medium">{item.name}</p>
                    {item.variant && (
                      <p className="text-xs text-muted-foreground">
                        {item.variant}
                      </p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">x{item.quantity}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(item.price, order.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MapPin className="size-3" /> Fulfillment
          </h4>
          <div className="dashboard-surface-elevated space-y-3 rounded-lg border p-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="font-medium text-foreground/70">
                Shipping Status
              </span>
              <StatusBadge status={order.shippingStatus} type="shipping" />
            </div>
            {order.shipping_provider && (
              <div className="flex justify-between">
                <span className="font-medium text-foreground/70">Provider</span>
                <span className="font-medium">{order.shipping_provider}</span>
              </div>
            )}
            {order.tracking_number && (
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground/70">
                  Tracking #
                </span>
                <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                  {order.tracking_number}
                </span>
              </div>
            )}
            <div className="pt-2">
              {orderDetailsHref ? (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={orderDetailsHref}>Open Order Details</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
