'use client';
import type { createPiggyvestCancellationController } from '@baci/shared/lib';
import { useEffect, useRef, useState } from 'react';
import { CancellationReview } from './cancellation-review';
import type { SavingsScreenSource } from './savings-screen.types';

export type CancellationBinding = ReturnType<
  typeof createPiggyvestCancellationController
>;
export function BoundCancellationReview({
  source,
  binding,
  isCompatible = () => true,
}: {
  source: SavingsScreenSource | null;
  binding: CancellationBinding | null;
  isCompatible?: () => boolean;
}) {
  const key = JSON.stringify(source);
  const latest = useRef({ key, binding });
  latest.current = { key, binding };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  binding?.setViewGuard?.(
    () =>
      mounted.current &&
      latest.current.key === key &&
      latest.current.binding === binding &&
      isCompatible()
  );
  const [, refresh] = useState(0);
  let view: ReturnType<CancellationBinding['read']> = null;
  try {
    view = binding?.read(source) ?? null;
  } catch {
    view = null;
  }
  if (!view || !binding)
    return <p role="status">Cancellation is unavailable.</p>;
  if (view.status !== 'review')
    return (
      <div>
        <p role="status">
          {!view.recovering && view.recovery?.status === 'prepared'
            ? 'Principal reservation retained. Not refunded; interest unresolved.'
            : !view.recovering && view.recovery?.status === 'absent'
              ? 'No matching operation observed. This does not authorize a retry.'
              : 'Cancellation requires recovery. Reservation may be retained. Do not resubmit.'}
        </p>
        <p>Provider dispatch unavailable. No new cancellation is authorized.</p>
        {!view.recovering && view.recovery?.status === 'prepared' && (
          <div>
            <p>Original disclosure — not current balances.</p>
            <p>
              Principal (kobo): {view.recovery.originalDisclosure.principalKobo}
            </p>
            <p>
              Paid interest (kobo):{' '}
              {view.recovery.originalDisclosure.paidInterestKobo}
            </p>
            <p>
              Pending interest (kobo):{' '}
              {view.recovery.originalDisclosure.pendingInterestKobo}
            </p>
          </div>
        )}
        <button
          type="button"
          disabled={view.recovering}
          onClick={async () => {
            const pending = binding.recover();
            refresh((value) => value + 1);
            await pending.catch(() => undefined);
            refresh((value) => value + 1);
          }}
        >
          Refresh cancellation status
        </button>
      </div>
    );
  return (
    <CancellationReview
      sessionKey={view.sessionKey}
      goalId={view.goalId}
      operationId={view.operationId}
      quote={view.quote}
      contextKey={JSON.stringify(source)}
      onPrepare={(command) => {
        if (
          !mounted.current ||
          latest.current.key !== key ||
          latest.current.binding !== binding ||
          !binding.read(source) ||
          !isCompatible()
        )
          return Promise.reject(new Error('Cancellation unavailable'));
        return binding.prepare(command);
      }}
    />
  );
}
