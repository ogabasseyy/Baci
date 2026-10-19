import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAdminReconciliationMoney } from '@/lib/admin-reconciliation-currency';
import type { AdminReconciliationData } from '@/schemas/admin-reconciliation-rpc';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

export function ReconciliationMetricSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: transient loading placeholders.
          key={index}
          className="h-28 rounded-xl"
        />
      ))}
    </div>
  );
}

export function ReconciliationMetrics({
  data,
}: {
  data: AdminReconciliationData;
}) {
  const { metrics } = data;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Paid order GMV"
          value={formatAdminReconciliationMoney(
            metrics.paidOrderGmv,
            data.currency
          )}
        />
        <Metric
          label="Captured payments"
          value={formatAdminReconciliationMoney(
            metrics.capturedPayments,
            data.currency
          )}
        />
        <Metric label="Platform settlements pending" value="Unavailable" />
        <Metric label="Platform settlements settled" value="Unavailable" />
        <Metric label="Direct settlements" value="Unavailable" />
        <Metric
          label="Wallet available now"
          value={formatAdminReconciliationMoney(
            metrics.wallet.availableAmount,
            data.currency
          )}
        />
        <Metric
          label="Payout requests pending"
          value={formatAdminReconciliationMoney(
            metrics.payoutRequests.pendingAmount,
            data.currency
          )}
        />
        <Metric
          label="Refunds completed"
          value={formatAdminReconciliationMoney(
            metrics.refunds.refundedAmount,
            data.currency
          )}
        />
      </div>
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 pt-6 text-sm text-muted-foreground">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p>
            Definitions: paid GMV is paid-order value; captured payments are
            completed payment transactions; platform and direct settlements are
            separate rails; wallet balances are current, not period totals;
            payout requests exclude legacy payouts; refunds include
            completed/refunded and refund-pending transaction states. Open
            reviews are unresolved reconciliation cases. Historical settlement
            currency is not recorded, so settlement amounts are unavailable.
            Open-review activity covers all unresolved reviews regardless of the
            selected money period; wallet currency reflects the current merchant
            payout currency. Generated{' '}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
