'use client';

import { piggyvestPurchaseSchemas } from '@baci/shared/contracts';
import {
  type createPiggyvestPurchaseController,
  formatPiggyvestPurchaseMoney,
} from '@baci/shared/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SavingsScreenSource } from './savings-screen.types';

export type PurchaseBinding = ReturnType<
  typeof createPiggyvestPurchaseController
>;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => 0;

export function BoundPurchaseReview({
  source,
  binding,
  selection,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: PurchaseBinding | null;
  selection?: unknown;
  isCompatible?: () => boolean;
}) {
  useSyncExternalStore(
    binding?.subscribe ?? emptySubscribe,
    binding?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  const key = JSON.stringify([source, selection]);
  const latest = useRef({ key, binding });
  latest.current = { key, binding };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  binding?.setViewGuard(
    () =>
      mounted.current &&
      latest.current.key === key &&
      latest.current.binding === binding &&
      isCompatible()
  );
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const view = binding?.read(source);
  const selected = piggyvestPurchaseSchemas.selection.safeParse(selection);
  const current = () =>
    latest.current.key === key &&
    latest.current.binding === binding &&
    binding?.read(source) !== null &&
    isCompatible();
  if (!binding || !view)
    return <p role="status">Purchase preparation unavailable.</p>;
  const review = view.status === 'review' ? view : null;
  const exactSelection =
    selected.success &&
    selected.data.goalId === view.goalId &&
    (!review ||
      (selected.data.quoteId === review.quote.quote.quoteId &&
        selected.data.shippingRateId === review.quote.shippingRateId &&
        selected.data.savingsKobo === review.quote.quote.savingsKobo));
  const accepted =
    !!review && acceptedKey === JSON.stringify([key, review.command]);
  async function perform(action: 'quote' | 'prepare' | 'recover') {
    if (
      !binding ||
      latest.current.key !== key ||
      latest.current.binding !== binding ||
      !binding.read(source)
    )
      return;
    if (action !== 'recover' && !current()) return;
    try {
      if (action === 'recover') await binding.recover();
      else if (action === 'quote' && selected.success) {
        setAcceptedKey(null);
        await binding.quote(selected.data);
      } else if (action === 'prepare' && review && accepted && exactSelection)
        await binding.prepare(review.command);
    } catch {
      return;
    }
  }
  return (
    <section aria-label="Pickup purchase preparation" className="space-y-3">
      <h3>Pickup purchase preparation</h3>
      <p>
        Local reservation only. No paid order, provider payment or fulfilment is
        enabled. Pending interest cannot fund this preparation.
      </p>
      {source?.status === 'ready' && (
        <p>
          {source.policy.device.productName} — {source.policy.device.variant} —{' '}
          {source.policy.device.condition}
        </p>
      )}
      {review ? (
        <>
          <p>
            Pickup only: {review.quote.pickupName},{' '}
            {review.quote.pickupAddress.address},{' '}
            {review.quote.pickupAddress.city}
          </p>
          <details>
            <summary>Technical quote identity</summary>
            <p>
              Exact product: {review.quote.quote.productId}; variant:{' '}
              {review.quote.quote.variantId ?? 'No variant'}; condition:{' '}
              {review.quote.quote.condition}; quantity:{' '}
              {review.quote.quote.quantity}
            </p>
          </details>
          <dl>
            {(
              [
                ['Device', review.quote.quote.deviceKobo],
                ['Delivery / pickup charge', review.quote.quote.deliveryKobo],
                ['Tax', review.quote.quote.taxKobo],
                ['Fees', review.quote.quote.feeKobo],
                ['Total', review.quote.quote.totalKobo],
                ['Your savings', review.quote.quote.savingsKobo],
                ['Principal included', review.quote.quote.principalKobo],
                [
                  'Confirmed paid interest included',
                  review.quote.quote.paidInterestKobo,
                ],
                [
                  'Remaining payment (unresolved)',
                  review.quote.quote.otherPaymentKobo,
                ],
                [
                  'Surplus (not withdrawal authority)',
                  review.quote.quote.surplusKobo,
                ],
              ] satisfies [string, number][]
            ).map(([name, amount]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{formatPiggyvestPurchaseMoney(amount)}</dd>
              </div>
            ))}
          </dl>
          <p>
            Tax treatment: {review.quote.taxTreatment}; included tax:{' '}
            {formatPiggyvestPurchaseMoney(review.quote.includedTaxKobo)}; fee
            policy: {review.quote.feePolicyVersion}.
          </p>
          <p>
            Current quote expires: {review.quote.quote.expiresAt}. This is not a
            guarantee expiry.
          </p>
          <p>
            Any other-payment amount remains unresolved. Surplus is not
            withdrawal authority.
          </p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              disabled={!exactSelection || !isCompatible()}
              onChange={(event) =>
                setAcceptedKey(
                  event.target.checked
                    ? JSON.stringify([key, review.command])
                    : null
                )
              }
            />
            I confirm this exact device, pickup location and price breakdown for
            local preparation only.
          </label>
          <button
            type="button"
            disabled={!accepted || !exactSelection || !isCompatible()}
            onClick={() => void perform('prepare')}
          >
            Prepare purchase reservation
          </button>
          {!exactSelection && (
            <p role="status">
              Selection changed. Obtain a fresh quote before confirmation.
            </p>
          )}
        </>
      ) : null}
      {['selection', 'review', 'unavailable'].includes(view.status) && (
        <button
          type="button"
          disabled={!selected.success || !isCompatible()}
          onClick={() => void perform('quote')}
        >
          Get pickup purchase quote
        </button>
      )}
      {view.status === 'loading_quote' && (
        <p role="status">Loading exact server quote…</p>
      )}
      {view.status === 'unavailable' && (
        <p role="status">Purchase quote unavailable.</p>
      )}
      {(view.status === 'pending' ||
        view.status === 'uncertain' ||
        view.status === 'prepared') && (
        <>
          <p role="status">
            {view.status === 'pending'
              ? 'Preparation pending. Do not resubmit.'
              : 'Preparation requires status review. Do not resubmit or create a new operation.'}
          </p>
          <details>
            <summary>Technical recovery reference</summary>
            <p>{view.operationId}</p>
          </details>
          {view.receipt && (
            <p>
              Historical receipt only: reserved savings{' '}
              {formatPiggyvestPurchaseMoney(view.receipt.savingsKobo)}
              {'; '}
              unresolved remaining payment{' '}
              {formatPiggyvestPurchaseMoney(view.receipt.otherPaymentKobo)}.
            </p>
          )}
          {!view.recovering && view.recovery?.current.status === 'observed' ? (
            <>
              <p>
                Current internal observation: reservation retained. Not paid or
                fulfilled.
              </p>
              <p>
                Observed at {view.recovery.current.observedAt}. Unreserved
                principal:{' '}
                {formatPiggyvestPurchaseMoney(
                  view.recovery.current.balances.unreservedPrincipalKobo
                )}
                ; paid interest:{' '}
                {formatPiggyvestPurchaseMoney(
                  view.recovery.current.balances.unreservedPaidInterestKobo
                )}
                {'; '}
                pending interest (excluded):{' '}
                {formatPiggyvestPurchaseMoney(
                  view.recovery.current.balances.pendingInterestKobo
                )}
                .
              </p>
              <p>These balances authorize neither withdrawal nor retry.</p>
            </>
          ) : (
            <p>
              Current reservation evidence unavailable or requires
              reconciliation. No release or retry is authorized.
            </p>
          )}
          <button
            type="button"
            disabled={view.status === 'pending' || view.recovering}
            onClick={() => void perform('recover')}
          >
            Refresh purchase status
          </button>
        </>
      )}
    </section>
  );
}
