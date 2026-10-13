'use client';

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatAdminCompactCurrency,
  formatAdminCurrency,
} from '@/lib/admin-currency';
import type {
  OrderStatusBreakdown,
  PaymentMethodBreakdown,
} from '@/types/analytics';

interface OrderPipelineBreakdownsProps {
  loading: boolean;
  paymentMethods: PaymentMethodBreakdown[];
  paymentStatuses: OrderStatusBreakdown[];
  periodLabel: string;
  shippingStatuses: OrderStatusBreakdown[];
}

const PIPELINE_SKELETON_IDS = [
  'pipeline-skeleton-a',
  'pipeline-skeleton-b',
  'pipeline-skeleton-c',
];

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function PipelineList({ items }: { items: ReactNode }) {
  return <div className="space-y-4">{items}</div>;
}

function PipelineSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4" data-testid="pipeline-loading">
      {PIPELINE_SKELETON_IDS.map((skeletonId) => (
        <div key={skeletonId} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

export function OrderPipelineBreakdowns({
  loading,
  paymentMethods,
  paymentStatuses,
  periodLabel,
  shippingStatuses,
}: OrderPipelineBreakdownsProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="glass">
        <CardHeader>
          <CardTitle>Payment Pipeline</CardTitle>
          <p className="text-sm text-muted-foreground">
            Order counts include all recorded currencies; amounts and value
            shares are NGN-only for orders created in the {periodLabel}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PipelineSkeleton />
          ) : paymentStatuses.length > 0 ? (
            <PipelineList
              items={paymentStatuses.map((status) => (
                <div key={status.status} className="space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{status.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {status.orders} orders across all currencies,{' '}
                        {formatPercent(status.shareOfOrders)} of order volume
                      </p>
                    </div>
                    <p className="text-sm font-semibold">
                      {formatAdminCompactCurrency(status.amount)}
                    </p>
                  </div>
                  <Progress
                    className="h-2"
                    value={Number(status.shareOfAmount.toFixed(2))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatPercent(status.shareOfAmount)} of NGN gross order
                    value
                  </p>
                </div>
              ))}
            />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
              No payment pipeline data for this window.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Fulfillment Pipeline</CardTitle>
          <p className="text-sm text-muted-foreground">
            Order counts include all recorded currencies; amounts and value
            shares are NGN-only for orders created in the {periodLabel}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PipelineSkeleton />
          ) : shippingStatuses.length > 0 ? (
            <PipelineList
              items={shippingStatuses.map((status) => (
                <div key={status.status} className="space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{status.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {status.orders} orders across all currencies,{' '}
                        {formatPercent(status.shareOfOrders)} of order volume
                      </p>
                    </div>
                    <p className="text-sm font-semibold">
                      {formatAdminCompactCurrency(status.amount)}
                    </p>
                  </div>
                  <Progress
                    className="h-2"
                    value={Number(status.shareOfAmount.toFixed(2))}
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatPercent(status.shareOfAmount)} of NGN gross order
                    value
                  </p>
                </div>
              ))}
            />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
              No fulfillment pipeline data for this window.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Paid Order Methods</CardTitle>
          <p className="text-sm text-muted-foreground">
            NGN paid-order method mix for orders created in the {periodLabel}.
            Other currencies are excluded.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <PipelineSkeleton />
          ) : paymentMethods.length > 0 ? (
            <div className="space-y-4">
              {paymentMethods.map((method) => (
                <div key={method.method} className="space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{method.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {method.orders} NGN paid orders,{' '}
                        {formatPercent(method.shareOfPaidAmount)} of NGN paid
                        GMV
                      </p>
                    </div>
                    <p className="text-sm font-semibold">
                      {formatAdminCurrency(method.amount)}
                    </p>
                  </div>
                  <Progress
                    className="h-2"
                    value={Number(method.shareOfPaidAmount.toFixed(2))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
              No paid orders for this window.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
