'use client';

import { ThemedButton } from '@/components/themed/themed-button';
import { ThemedCard } from '@/components/themed/themed-card';
import type { CustomerSavingsStatusProps } from './customer-savings-status.types';

const unavailableMessage =
  'Savings status is unavailable. Please try again later.';
const stateMessages = {
  loading: 'Loading savings status…',
  unavailable: unavailableMessage,
  pending_wallet: 'Your savings wallet is pending confirmation.',
};
const readinessMessages = {
  continue_saving: 'Continue saving.',
  ready_for_review: 'Your savings are ready for review.',
  review_required: 'Your savings need review.',
  not_available: 'Savings readiness is unavailable.',
};
const nairaFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const koboPerNaira = BigInt(100);

function formatInternalKobo(amount: number): string {
  const kobo = BigInt(amount);
  return `${nairaFormatter.format(kobo / koboPerNaira)}.${String(
    kobo % koboPerNaira
  ).padStart(2, '0')}`;
}

function isInternalKobo(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 0;
}

export function CustomerSavingsStatus(props: CustomerSavingsStatusProps) {
  const ready =
    props.status === 'ready' &&
    isInternalKobo(props.decision.purchasingPowerKobo) &&
    isInternalKobo(props.decision.devicePriceKobo) &&
    (props.pendingInterestKobo === null ||
      isInternalKobo(props.pendingInterestKobo))
      ? props
      : null;
  const canReview =
    ready?.decision.purchaseAction === 'requires_customer_confirmation';
  const message = ready
    ? readinessMessages[ready.decision.readiness]
    : props.status === 'ready'
      ? unavailableMessage
      : stateMessages[props.status];

  return (
    <section aria-label="Customer savings">
      <ThemedCard
        borderColor="primary"
        className="space-y-4 bg-store-background p-4 text-store-background-text"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Customer savings</h2>
          <span className="rounded border border-store-primary px-2 py-1 text-sm">
            Staging
          </span>
        </div>
        <dl className="space-y-2 break-words">
          <div>
            <dt className="text-sm">Product</dt>
            <dd>{props.device.productName}</dd>
          </div>
          {props.device.variant !== null && (
            <div>
              <dt className="text-sm">Variant</dt>
              <dd>{props.device.variant}</dd>
            </div>
          )}
          <div>
            <dt className="text-sm">Condition</dt>
            <dd>{props.device.condition}</dd>
          </div>
        </dl>
        <p role="status" aria-live="polite" aria-atomic="true">
          {message}
          {ready?.actionPending ? ' An action is pending.' : ''}
        </p>
        {ready && (
          <>
            <dl className="space-y-3">
              <div>
                <dt>Server-confirmed purchasing power</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {formatInternalKobo(ready.decision.purchasingPowerKobo)}
                </dd>
              </div>
              <div>
                <dt>Device price</dt>
                <dd className="tabular-nums">
                  {formatInternalKobo(ready.decision.devicePriceKobo)}
                </dd>
              </div>
              <div>
                <dt>Pending interest — not spendable</dt>
                <dd className="tabular-nums">
                  {ready.pendingInterestKobo === null
                    ? 'Pending interest unavailable'
                    : formatInternalKobo(ready.pendingInterestKobo)}
                </dd>
              </div>
            </dl>
            <p className="text-sm">
              Pending interest is excluded from purchasing power.
            </p>
            {canReview ? (
              <ThemedButton
                type="button"
                disabled={ready.actionPending}
                onClick={() => {
                  if (
                    !ready.actionPending &&
                    ready.decision.purchaseAction ===
                      'requires_customer_confirmation'
                  )
                    ready.onReviewPurchase();
                }}
              >
                Review purchase
              </ThemedButton>
            ) : (
              <p>Purchase review is currently unavailable.</p>
            )}
          </>
        )}
      </ThemedCard>
    </section>
  );
}
