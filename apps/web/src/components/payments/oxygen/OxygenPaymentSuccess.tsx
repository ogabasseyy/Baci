'use client';
import { Check, CircleCheck, Clock3 } from 'lucide-react';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenActivationTrial } from './OxygenActivationTrial';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import {
  type OxygenCheckoutProduct,
  OxygenProductSummary,
} from './OxygenProductSummary';

export function OxygenPaymentSuccess({
  reference,
  plan,
  products,
  onDone,
}: {
  reference: string;
  plan?: OxygenProviderState;
  products?: OxygenCheckoutProduct[];
  onDone?: () => void;
}) {
  const selected =
    plan?.bookingReference === reference &&
    plan.booking?.loan_reference === reference
      ? plan
      : undefined;
  const upfront = selected?.booking?.total_upfront_payment;
  const amount =
    typeof upfront === 'number' && Number.isFinite(upfront) && upfront > 0
      ? new Intl.NumberFormat('en-NG', {
          style: 'currency',
          currency: 'NGN',
        }).format(upfront)
      : null;
  return (
    <section
      aria-label="Confirmed payment"
      className="overflow-hidden rounded-3xl border border-emerald-100 bg-white"
    >
      <div
        role="status"
        className="bg-gradient-to-b from-emerald-50 to-white px-5 pb-5 pt-8 text-center sm:px-6"
      >
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100 ring-8 ring-emerald-50">
          <CircleCheck
            aria-hidden="true"
            className="size-9 text-emerald-700"
            strokeWidth={1.8}
          />
        </div>
        <h3 className="text-2xl font-bold tracking-tight text-gray-900">
          Payment confirmed
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-600">
          Oxygen has confirmed your upfront payment and repayment setup.
        </p>
        {amount && (
          <div className="mt-5">
            <p className="text-xs font-medium text-gray-500">
              Selected upfront amount
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-gray-900">
              {amount}
            </p>
          </div>
        )}
      </div>
      <div className="grid gap-5 px-5 pb-6 sm:px-6">
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-medium text-emerald-800">
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden="true" className="size-4" />
            Upfront payment confirmed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden="true" className="size-4" />
            Repayment setup complete
          </span>
        </div>
        {products?.length ? <OxygenProductSummary products={products} /> : null}
        <div className="flex gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <Clock3
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-gray-500"
          />
          <div>
            <h4 className="text-sm font-semibold text-gray-900">
              Awaiting order confirmation
            </h4>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              Your payment step is complete. Your order can move forward once
              the remaining checks are complete. You don’t need to pay again.
            </p>
          </div>
        </div>
        {selected?.booking && selected.schedule?.length ? (
          <details className="border-t border-gray-100 pt-1">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-gray-700">
              View selected plan
            </summary>
            <OxygenComparisonSummary
              state={selected}
              loading={false}
              tenure={selected.booking.loan_tenure}
            />
          </details>
        ) : null}
        <OxygenActivationTrial reference={reference} />
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="min-h-12 w-full rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Back to checkout
          </button>
        )}
      </div>
    </section>
  );
}
