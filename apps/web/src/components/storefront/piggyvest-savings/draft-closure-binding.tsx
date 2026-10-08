'use client';

import type { SavingsScreenSource } from '@baci/shared/contracts';
import type { createPiggyvestDraftClosureController } from '@baci/shared/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type DraftClosureBinding = ReturnType<
  typeof createPiggyvestDraftClosureController
>;
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => 0;
export function BoundDraftClosureReview({
  source,
  binding: supplied,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: DraftClosureBinding | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
  const binding =
    supplied &&
    (
      [
        'setViewGuard',
        'setCompatibilityGuard',
        'subscribe',
        'getSnapshot',
        'read',
        'refresh',
        'close',
      ] as const
    ).every((method) => typeof supplied[method] === 'function')
      ? supplied
      : null;
  const sourceKey = JSON.stringify(source);
  const current = useRef({ binding, sourceKey, active: true });
  if (
    current.current.binding !== binding ||
    current.current.sourceKey !== sourceKey
  )
    current.current = { binding, sourceKey, active: true };
  const lease = current.current;
  binding?.setViewGuard(() => current.current === lease && lease.active);
  binding?.setCompatibilityGuard(isCompatible);
  useEffect(() => {
    lease.active = true;
    return () => {
      lease.active = false;
    };
  }, [lease]);
  useSyncExternalStore(
    binding?.subscribe ?? emptySubscribe,
    binding?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  const [consent, setConsent] = useState<{
    lease: typeof lease;
    version: number;
  } | null>(null);
  let view: ReturnType<DraftClosureBinding['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!view || !binding) return <p role="status">Plan closure unavailable.</p>;
  const checked =
    consent?.lease === lease && consent.version === view.reviewVersion;
  async function perform(close: boolean) {
    try {
      if (
        !binding ||
        disabled ||
        current.current !== lease ||
        !lease.active ||
        (close && isCompatible() !== true)
      )
        return;
      if (!binding.read(source)) return;
      setConsent(null);
      if (close) {
        await binding.close(checked, view?.reviewVersion);
      } else await binding.refresh();
    } catch {
      return;
    }
  }
  return (
    <section aria-label="Close unfunded plan">
      <h3>Close unfunded plan</h3>
      <p>
        Only a server-verified unfunded, unexposed draft can be closed. This
        does not issue a refund or delete a provider wallet.
      </p>
      <p role="status" aria-live="polite">
        {view.busy
          ? 'Checking plan closure…'
          : view.status === 'closed'
            ? 'Plan closed. No refund issued; no provider wallet deleted.'
            : view.status === 'uncertain'
              ? 'Closure outcome unconfirmed. Refresh status; do not resubmit.'
              : view.status === 'requires_reconciliation'
                ? 'Funding exposure requires reconciliation. Plan not closed or refunded.'
                : view.status === 'review'
                  ? 'Unfunded draft available for closure review.'
                  : 'Plan closure unavailable.'}
      </p>
      {view.status === 'review' && (
        <>
          <p>{view.terms.text}</p>
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || view.busy}
              onChange={(event) =>
                setConsent(
                  event.target.checked
                    ? { lease, version: view.reviewVersion }
                    : null
                )
              }
            />
            I confirm closing this unfunded draft under these terms.
          </label>
          <button
            type="button"
            disabled={disabled || view.busy || !checked}
            onClick={() => void perform(true)}
          >
            Close plan
          </button>
        </>
      )}
      <button
        type="button"
        disabled={view.busy}
        onClick={() => void perform(false)}
      >
        Refresh plan closure
      </button>
    </section>
  );
}
