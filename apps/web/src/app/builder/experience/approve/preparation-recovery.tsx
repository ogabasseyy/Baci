'use client';

import { useEffect, useRef, useState } from 'react';
import { prepareApprovalUntilReady } from './prepare-approval';

export function ExperiencePreparationRecovery({
  approvalId,
  kind,
}: {
  approvalId: string;
  kind: 'draft' | 'lifecycle';
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);

  async function resume() {
    if (preparation.current) return;
    const controller = new AbortController();
    preparation.current = controller;
    setBusy(true);
    setMessage('Preparing route evidence…');
    try {
      const result = await prepareApprovalUntilReady({
        approvalId,
        action: kind === 'draft' ? 'prepare-draft' : 'prepare-publication',
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const url = new URL(window.location.href);
      url.searchParams.set('approval', result.approvalId);
      window.location.replace(url);
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          'Preparation could not resume. Request a fresh approval if the review changed.'
        );
    } finally {
      preparation.current = null;
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Approval window expired</h1>
      <p>
        Resume preparation to review the same change in a new approval window.
      </p>
      <button type="button" onClick={resume} disabled={busy}>
        Resume preparation
      </button>
      {message ? <p role="status">{message}</p> : null}
    </main>
  );
}
