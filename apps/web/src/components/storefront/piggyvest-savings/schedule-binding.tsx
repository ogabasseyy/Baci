'use client';

import type { SavingsScreenSource } from '@baci/shared/contracts';
import type { createPiggyvestScheduleController } from '@baci/shared/lib';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type ScheduleBinding = ReturnType<
  typeof createPiggyvestScheduleController
>;
const subscribeEmpty = () => () => undefined;
const emptySnapshot = () => 0;

export function BoundScheduleReview({
  source,
  binding: suppliedBinding,
  disabled = false,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: ScheduleBinding | null;
  disabled?: boolean;
  isCompatible?: () => boolean;
}) {
  const binding =
    suppliedBinding &&
    (
      [
        'setViewGuard',
        'setCompatibilityGuard',
        'subscribe',
        'getSnapshot',
        'read',
        'refresh',
        'pause',
        'requestResume',
      ] as const
    ).every((method) => typeof suppliedBinding[method] === 'function')
      ? suppliedBinding
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
    binding?.subscribe ?? subscribeEmpty,
    binding?.getSnapshot ?? emptySnapshot,
    emptySnapshot
  );
  const [accepted, setAccepted] = useState<{
    lease: typeof lease;
    version: number;
  } | null>(null);
  let view: ReturnType<ScheduleBinding['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!binding || !view)
    return <p role="status">Schedule review unavailable.</p>;
  const checked =
    accepted?.lease === lease &&
    accepted.version === view.snapshot?.state.version;
  const blocked = disabled || view.busy;
  async function perform(action: 'refresh' | 'pause' | 'resume') {
    if (
      !binding ||
      disabled ||
      current.current !== lease ||
      !lease.active ||
      !binding.read(source) ||
      isCompatible() !== true
    )
      return;
    setAccepted(null);
    try {
      if (action === 'resume')
        await binding.requestResume(checked, view?.snapshot?.state.version);
      else await binding[action]();
    } catch {
      return;
    }
  }
  return (
    <section aria-label="Schedule proposal review">
      <h3>Schedule proposal review</h3>
      <p>
        No automatic collection is enabled. A saved proposal is not debit
        permission. Existing Paystack collection is unchanged.
      </p>
      <p>Cadence and collection-owner handover are unavailable.</p>
      <p role="status" aria-live="polite">
        {view.busy
          ? 'Checking schedule proposal…'
          : view.status === 'uncertain'
            ? 'Outcome unconfirmed. Recover the same operation; do not resubmit.'
            : view.status !== 'ready'
              ? 'Schedule review unavailable. Refresh to check.'
              : `Last recorded proposal: ${view.snapshot?.state.status}. Not an active collection schedule.`}
      </p>
      {view.operationId && <p>Recovery operation: {view.operationId}</p>}
      {view.historical && (
        <p>
          Historical receipt: {view.historical.receipt.operationId} —{' '}
          {view.historical.receipt.state.status}. History only, not current
          authority.
        </p>
      )}
      <p>{view.terms.text}</p>
      <p>
        Terms revision: {view.snapshot?.revisionId ?? 'unavailable'}; version:{' '}
        {view.terms.version}
      </p>
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={blocked || !view.canRequestResume}
          onChange={(event) =>
            setAccepted(
              event.target.checked && view.snapshot
                ? { lease, version: view.snapshot.state.version }
                : null
            )
          }
        />
        I request a saved resume proposal under these terms, not an automatic
        debit.
      </label>
      <button
        type="button"
        disabled={blocked || !checked || !view.canRequestResume}
        onClick={() => void perform('resume')}
      >
        Save resume proposal
      </button>
      <button
        type="button"
        disabled={blocked || view.status !== 'ready'}
        onClick={() => void perform('pause')}
      >
        Pause schedule proposal
      </button>
      <button
        type="button"
        disabled={blocked}
        onClick={() => void perform('refresh')}
      >
        Refresh schedule review
      </button>
    </section>
  );
}
