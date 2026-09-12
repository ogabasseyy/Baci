'use client';

import { AlertCircle, CreditCard, LoaderCircle } from 'lucide-react';

export type RedvaultQuoteSummary = {
  productSubtotalKobo: number;
  eligibleSubtotalKobo: number;
  discountKobo: number;
  assuranceFeeKobo: number;
  ineligibleSubtotalKobo: number;
  taxKobo: number;
  shippingKobo: number;
  giftWrappingKobo: number;
  payableKobo: number;
  mixedBasket: boolean;
};

export type RedvaultPaymentStatus = 'idle' | 'pending' | 'held' | 'error';

type RedvaultPaymentOptionProps = {
  available: boolean;
  selected: boolean;
  status: RedvaultPaymentStatus;
  summary: RedvaultQuoteSummary | null;
  onSelect: () => void;
};

function formatKobo(amountKobo: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountKobo / 100);
}

function StatusMessage({ status }: { status: RedvaultPaymentStatus }) {
  if (status === 'pending') {
    return (
      <p
        className="flex items-center gap-2 text-xs text-store-background-text/70"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Payment setup is awaiting reconciliation. Your order is not yet paid.
      </p>
    );
  }

  if (status === 'held') {
    return (
      <p
        className="flex items-center gap-2 text-xs text-store-background-text/70"
        role="alert"
      >
        <AlertCircle aria-hidden="true" className="size-4" />
        Payment received; your order is awaiting verification. Please do not pay
        again.
      </p>
    );
  }

  if (status === 'error') {
    return (
      <p
        className="flex items-center gap-2 text-xs text-destructive"
        role="alert"
      >
        <AlertCircle aria-hidden="true" className="size-4" />
        We could not prepare Pay with UBA. Choose another payment method or try
        again.
      </p>
    );
  }

  return null;
}

export function RedvaultPaymentOption({
  available,
  selected,
  status,
  summary,
  onSelect,
}: RedvaultPaymentOptionProps) {
  if (!available) {
    return null;
  }

  const selectionDisabled =
    status === 'pending' ||
    status === 'held' ||
    summary?.eligibleSubtotalKobo === 0;

  return (
    <section aria-label="UBA REDVAULT payment option" className="space-y-3">
      <label
        className={`relative flex items-center gap-3 rounded-xl border-2 p-4 transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-store-primary has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-store-background ${
          selected
            ? 'border-store-primary bg-store-primary/5'
            : 'border-store-background-text/15 bg-store-background/50'
        } ${selectionDisabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
      >
        <input
          checked={selected}
          className="sr-only"
          disabled={selectionDisabled}
          name="payment"
          onChange={onSelect}
          type="radio"
          value="uba_redvault"
        />
        <span
          aria-hidden="true"
          className={`flex size-5 items-center justify-center rounded-full border-2 ${
            selected
              ? 'border-store-primary'
              : 'border-store-background-text/50'
          }`}
        >
          {selected && (
            <span className="size-2.5 rounded-full bg-store-primary" />
          )}
        </span>
        <span className="flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold text-store-background-text">
              Pay with UBA
            </span>
            {summary && summary.discountKobo > 0 && (
              <span className="rounded-full bg-store-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-store-primary">
                Tiered savings on eligible items
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-store-background-text/70">
            10% off when the eligible pre-discount subtotal is below ₦200,000;
            5% at ₦200,000 or more. Excluded products and fees do not count
            toward this threshold.
          </span>
          <span className="mt-0.5 block text-xs text-store-background-text/70">
            {summary
              ? 'Your savings are included in the total below.'
              : 'Savings are confirmed after we validate your order.'}
          </span>
        </span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-store-primary/10 text-store-primary">
          <CreditCard aria-hidden="true" className="size-4" />
        </span>
      </label>

      {selected && (
        <div className="space-y-3 rounded-xl border border-store-primary/20 bg-store-primary/5 p-4">
          {summary && (
            <>
              <dl className="space-y-2 text-sm text-store-background-text/80">
                <div className="flex justify-between gap-4">
                  <dt>Product subtotal</dt>
                  <dd>{formatKobo(summary.productSubtotalKobo)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Eligible items</dt>
                  <dd>{formatKobo(summary.eligibleSubtotalKobo)}</dd>
                </div>
                {summary.discountKobo > 0 && (
                  <div className="flex justify-between gap-4 text-store-primary">
                    <dt>UBA REDVAULT savings</dt>
                    <dd>-{formatKobo(summary.discountKobo)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt>Ineligible items</dt>
                  <dd>{formatKobo(summary.ineligibleSubtotalKobo)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Tax</dt>
                  <dd>{formatKobo(summary.taxKobo)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Shipping</dt>
                  <dd>{formatKobo(summary.shippingKobo)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Gift wrapping</dt>
                  <dd>{formatKobo(summary.giftWrappingKobo)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Total due</dt>
                  <dd>{formatKobo(summary.payableKobo)}</dd>
                </div>
              </dl>
              {summary.mixedBasket && (
                <p>Savings apply only to eligible items in this mixed basket.</p>
              )}
            </>
          )}
          <StatusMessage status={status} />
        </div>
      )}
    </section>
  );
}
