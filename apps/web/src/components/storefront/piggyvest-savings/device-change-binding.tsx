'use client';

import { piggyvestDeviceChangeSchemas } from '@baci/shared/contracts';
import {
  type createPiggyvestDeviceChangeController,
  formatPiggyvestPurchaseMoney,
} from '@baci/shared/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SavingsScreenSource } from './savings-screen.types';

export type DeviceChangeBinding = ReturnType<
  typeof createPiggyvestDeviceChangeController
>;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => 0;
export function BoundDeviceChangeReview({
  source,
  binding,
  selection,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: DeviceChangeBinding | null;
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
  const current = () =>
    mounted.current &&
    latest.current.key === key &&
    latest.current.binding === binding &&
    isCompatible();
  binding?.setViewGuard(current);
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const view = binding?.read(source);
  const selected = piggyvestDeviceChangeSchemas.selection.safeParse(selection);
  if (!binding || !view) return <p role="status">Device change unavailable.</p>;
  const review = view.status === 'review' ? view : null;
  const exact =
    selected.success &&
    selected.data.goalId === view.goalId &&
    (!review ||
      (selected.data.quoteId === review.published.quote.quoteId &&
        selected.data.productId === review.published.quote.device.productId &&
        selected.data.variantId === review.published.quote.device.variantId));
  const accepted =
    !!review && acceptedKey === JSON.stringify([key, review.command]);
  async function perform(action: 'quote' | 'confirm' | 'recover') {
    if (
      !binding ||
      !mounted.current ||
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
      } else if (action === 'confirm' && review && accepted && exact)
        await binding.confirm(review.command);
    } catch {
      return;
    }
  }
  return (
    <section aria-label="Change savings device" className="space-y-3">
      <h3>Change savings device</h3>
      <p>
        Your existing wallet and savings stay with this plan. No purchase,
        payout, fulfilment or automatic collection is enabled.
      </p>
      {review && (
        <>
          <p>
            {review.published.quote.device.productName} —{' '}
            {review.published.quote.device.variant ?? 'No variant'} —{' '}
            {review.published.quote.device.condition}
          </p>
          <p>
            Server price:{' '}
            {formatPiggyvestPurchaseMoney(review.published.quote.priceKobo)}
          </p>
          <p>
            Recorded duration:{' '}
            {review.published.quote.durationMonths === null
              ? 'Not available; no new duration inferred'
              : `${review.published.quote.durationMonths} months`}
          </p>
          <p>
            Existing maturity:{' '}
            {review.published.quote.maturesAt ?? 'Not established'}. Grace
            review date:{' '}
            {review.published.quote.graceExpiresAt ?? 'Not established'}. These
            dates do not authorize forfeiture.
          </p>
          <p>Quote valid until: {review.published.quote.expiresAt}</p>
          <p className="whitespace-pre-wrap">{review.published.terms.text}</p>
          <p>Terms version: {review.published.terms.version}</p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              disabled={!exact || !isCompatible()}
              onChange={(event) =>
                setAcceptedKey(
                  event.target.checked
                    ? JSON.stringify([key, review.command])
                    : null
                )
              }
            />
            I accept this exact device, server price and displayed revised
            terms.
          </label>
          <button
            type="button"
            disabled={!accepted || !exact || !isCompatible()}
            onClick={() => void perform('confirm')}
          >
            Confirm device change
          </button>
          {!exact && (
            <p role="status">Selection changed. Review a fresh server quote.</p>
          )}
        </>
      )}
      {['selection', 'review', 'unavailable'].includes(view.status) && (
        <button
          type="button"
          disabled={!selected.success || !isCompatible()}
          onClick={() => void perform('quote')}
        >
          Review device change
        </button>
      )}
      {view.status === 'loading_quote' && (
        <p role="status">Loading server device quote…</p>
      )}
      {view.status === 'unavailable' && (
        <p role="status">Device quote unavailable.</p>
      )}
      {(view.status === 'pending' ||
        view.status === 'uncertain' ||
        view.status === 'confirmed') && (
        <>
          <p role="status">
            {view.status === 'pending'
              ? 'Device change pending.'
              : 'Device change needs readback before continuing.'}{' '}
            Do not resubmit or create a new operation.
          </p>
          {!view.recovering && view.historical && (
            <p>
              Historical receipt: {view.historical.receipt.device.productName} —{' '}
              {view.historical.receipt.device.variant ?? 'No variant'}; agreed
              price{' '}
              {formatPiggyvestPurchaseMoney(view.historical.receipt.priceKobo)}.
              Wallet and balances unchanged; collection paused. Reload the
              current server plan before further actions.
            </p>
          )}
          <details>
            <summary>Technical recovery reference</summary>
            {view.operationId}
          </details>
          <button
            type="button"
            disabled={view.status === 'pending' || view.recovering}
            onClick={() => void perform('recover')}
          >
            Refresh device change status
          </button>
        </>
      )}
    </section>
  );
}
