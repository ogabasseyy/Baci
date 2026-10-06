'use client';

import {
  type createPiggyvestProtectedOfferController,
  formatPiggyvestPurchaseMoney,
} from '@baci/shared/lib';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SavingsScreenSource } from './savings-screen.types';

export type ProtectedOfferBinding = ReturnType<
  typeof createPiggyvestProtectedOfferController
>;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => 0;

export function BoundProtectedOffer({
  source,
  binding,
}: {
  source: SavingsScreenSource | null;
  binding: ProtectedOfferBinding | null;
}) {
  useSyncExternalStore(
    binding?.subscribe ?? emptySubscribe,
    binding?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  const key = JSON.stringify(source);
  const current = useRef({ key, binding });
  current.current = { key, binding };
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
      current.current.key === key &&
      current.current.binding === binding
  );
  const view = binding?.read(source);
  if (!binding || !view)
    return <p role="status">Protected offer unavailable for this plan.</p>;
  const observation = view.observation;
  const receipt = observation?.receipt ?? view.receipt;
  async function refresh() {
    if (
      !binding ||
      !mounted.current ||
      current.current.key !== key ||
      current.current.binding !== binding ||
      !binding.read(source)
    )
      return;
    await binding.load().catch(() => undefined);
  }
  return (
    <section
      aria-label="Seven-day protected device offer"
      className="space-y-3"
    >
      <h3>Seven-day protected device offer</h3>
      <p>
        No additional acceptance is needed for this price promise. Your existing
        checkout review and confirmation still apply.
      </p>
      <p>
        This offer covers the device price only. Delivery, taxes and fees are
        checked at checkout. It does not reserve physical stock or confirm that
        your available savings cover the purchase.
      </p>
      {receipt && (
        <>
          {source?.status === 'ready' && (
            <p>
              {source.policy.device.productName} —{' '}
              {source.policy.device.variant ?? 'No variant'} —{' '}
              {source.policy.device.condition}
            </p>
          )}
          <p>{formatPiggyvestPurchaseMoney(receipt.priceKobo)}</p>
          <p>
            Original seven-day window: {receipt.startsAt} to {receipt.expiresAt}
            .
          </p>
          <p>A refresh does not restart or extend this window.</p>
        </>
      )}
      <p role="status" aria-live="polite">
        {view.busy
          ? 'Checking the server’s protected offer…'
          : observation
            ? `Server checked: ${observation.pricePromise}. Observed at ${observation.observedAt}.`
            : view.status === 'unavailable'
              ? 'Current offer status could not be verified. Any recorded price above is historical, not current checkout authority.'
              : 'Check the server for your plan’s protected offer.'}
      </p>
      {observation?.pricePromise === 'active' && (
        <p>
          The server observed this exact-device price promise within its
          original window. A catalogue price increase does not cancel the
          promise. Checkout still verifies current funds, charges and
          eligibility.
        </p>
      )}
      {observation?.pricePromise === 'expired' && (
        <p>
          The seven-day offer window has ended. Your original guarantee is not
          cancelled. Checkout recalculates using current eligible pricing and
          any still-valid original guarantee. Automatic contributions do not
          restart without fresh consent.
        </p>
      )}
      {observation?.pricePromise === 'historical' && (
        <p>
          This offer belongs to an earlier plan or device revision. It is
          history only, not a price for the current device.
        </p>
      )}
      <p>
        No payment, order or fulfilment is performed by checking this offer.
      </p>
      <button type="button" disabled={view.busy} onClick={() => void refresh()}>
        {receipt ? 'Refresh protected offer' : 'Check protected offer'}
      </button>
    </section>
  );
}
