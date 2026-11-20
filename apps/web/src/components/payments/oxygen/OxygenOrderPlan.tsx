'use client';

// Reads saved plan facts after an authenticated order-history page mounts.
import {
  formatOxygenPaymentDate,
  formatOxygenRepaymentReceiptDate,
  OXYGEN_REPAYMENT_HISTORY_LIMIT,
  oxygenOrderPlanResponseSchema,
  type OxygenOrderPlan as Plan,
} from '@baci/shared/schemas/oxygen-order-plan';
import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayCurrency } from '@/lib/format-display-currency';

const planAnchor = 'oxygen-payment-plan';

export function OxygenOrderPlan({
  orderId,
  currency,
}: {
  orderId: string;
  currency: string;
}) {
  const [result, setResult] = useState<{
    id: string;
    plan?: Plan;
    failed?: boolean;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch(
          `/api/payments/oxygen/order-plan?orderId=${encodeURIComponent(orderId)}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) throw new Error('Unavailable');
        const { plan } = oxygenOrderPlanResponseSchema.parse(
          await response.json()
        );
        if (!controller.signal.aborted)
          setResult({
            id: orderId,
            plan: plan ?? undefined,
          });
      } catch {
        if (!controller.signal.aborted)
          setResult({ id: orderId, failed: true });
      }
    }
    void read();
    return () => controller.abort();
  }, [orderId]);
  if (result?.id !== orderId)
    return (
      <p
        id={planAnchor}
        role="status"
        className="scroll-mt-24 text-sm text-muted-foreground"
      >
        Loading payment plan…
      </p>
    );
  if (result.failed)
    return (
      <p
        id={planAnchor}
        role="status"
        className="scroll-mt-24 text-sm text-muted-foreground"
      >
        Your saved payment plan is temporarily unavailable. Reopen this order to
        try again.
      </p>
    );
  const plan = result.plan;
  if (!plan) return null;
  const money = (amount: number) => formatDisplayCurrency(amount, currency);
  return (
    <Card
      aria-label="Oxygen payment plan"
      className="scroll-mt-24"
      id={planAnchor}
      role="region"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-5 text-primary" />
          Oxygen payment plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {plan.activationConfirmed && (
          <p className="font-semibold text-emerald-700 dark:text-emerald-400">
            Payment plan active
          </p>
        )}
        <p className="text-muted-foreground">
          Saved plan · {plan.months} monthly{' '}
          {plan.months === 1 ? 'payment' : 'payments'}
        </p>
        {plan.upfront !== null && (
          <div className="flex justify-between gap-4">
            <span>
              Upfront payment{plan.upfrontConfirmed ? ' confirmed' : ''}
            </span>
            <strong>{money(plan.upfront)}</strong>
          </div>
        )}
        <div className="border-t pt-3">
          <h3 className="font-semibold">Payment schedule</h3>
          {plan.schedule.length ? (
            <ol className="mt-2 divide-y">
              {plan.schedule.map(({ period, dueDate, amount }) => (
                <li
                  key={period}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2"
                >
                  <div>
                    <p className="font-medium">Instalment {period}</p>
                    <p className="text-muted-foreground">
                      {formatOxygenPaymentDate(dueDate)}
                    </p>
                  </div>
                  <strong className="tabular-nums">{money(amount)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-muted-foreground">
              Payment dates are currently unavailable for this plan.
            </p>
          )}
          {plan.scheduleIncomplete && plan.schedule.length > 0 && (
            <p className="mt-2 text-muted-foreground">
              Some payment dates are unavailable. Check your Oxygen agreement
              for the full schedule.
            </p>
          )}
        </div>
        {Boolean(plan.repaymentReceipts?.length) && (
          <div className="border-t pt-3">
            <h3 className="font-semibold">Repayment updates</h3>
            <p className="text-muted-foreground">
              Shows up to {OXYGEN_REPAYMENT_HISTORY_LIMIT} recent updates from
              Oxygen.
            </p>
            <ul className="mt-2 divide-y">
              {plan.repaymentReceipts?.map(({ id, recordedAt }) => (
                <li
                  key={id}
                  className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2"
                >
                  <span className="font-medium">
                    Oxygen reported a repayment
                  </span>
                  <time className="text-muted-foreground" dateTime={recordedAt}>
                    Recorded {formatOxygenRepaymentReceiptDate(recordedAt)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-muted-foreground">
          Monthly repayment status is not available here yet. Refer to Oxygen’s
          payment confirmation for repayments made.
        </p>
      </CardContent>
    </Card>
  );
}
