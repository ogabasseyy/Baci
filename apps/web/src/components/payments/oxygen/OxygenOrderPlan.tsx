'use client';

// Reads saved plan facts after an authenticated order-history page mounts.
import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import {
  oxygenOrderPlanSchema,
  type OxygenOrderPlan as Plan,
} from '@/schemas/oxygen-order-plan';

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
        const body = await response.json();
        if (!controller.signal.aborted)
          setResult({
            id: orderId,
            plan:
              body.plan === null
                ? undefined
                : oxygenOrderPlanSchema.parse(body.plan),
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
      <p role="status" className="text-sm text-muted-foreground">
        Loading payment plan…
      </p>
    );
  if (result.failed)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Your saved payment plan is temporarily unavailable. Reopen this order to
        try again.
      </p>
    );
  const plan = result.plan;
  if (!plan) return null;
  const money = (amount: number) => formatDisplayCurrency(amount, currency);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" className="size-5 text-primary" />
          Oxygen payment plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {plan.activationConfirmed && (
          <p className="font-semibold text-emerald-700">Payment plan active</p>
        )}
        <p className="text-muted-foreground">
          Saved plan · {plan.months} monthly payments
        </p>
        {plan.upfront !== null && (
          <div className="flex justify-between gap-4">
            <span>
              Upfront payment{plan.upfrontConfirmed ? ' confirmed' : ''}
            </span>
            <strong>{money(plan.upfront)}</strong>
          </div>
        )}
        <details>
          <summary className="cursor-pointer font-medium">
            Payment dates
          </summary>
          <ul className="mt-3 space-y-2">
            {plan.schedule.map((row) => (
              <li key={row.period} className="flex justify-between gap-4">
                <span>
                  {new Intl.DateTimeFormat('en-NG', {
                    dateStyle: 'medium',
                    timeZone: 'UTC',
                  }).format(
                    new Date(
                      Date.UTC(
                        row.dueDate[0],
                        row.dueDate[1] - 1,
                        row.dueDate[2]
                      )
                    )
                  )}
                </span>
                <strong>{money(row.amount)}</strong>
              </li>
            ))}
          </ul>
          {!plan.schedule.length && (
            <p className="mt-3 text-muted-foreground">
              Payment dates are not saved for this plan.
            </p>
          )}
        </details>
        <p className="text-muted-foreground">
          Monthly repayment status is not available here yet. Refer to Oxygen’s
          payment confirmation for repayments made.
        </p>
      </CardContent>
    </Card>
  );
}
