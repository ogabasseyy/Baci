'use client';
import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
/** Reconciles the existing receipt; never requests a new publication intent. */
export function ExperienceVerificationRetry({
  approvalId,
}: {
  approvalId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState(false);
  async function retry() {
    if (busy || status !== 'verifying') return;
    setBusy(true);
    setError(false);
    try {
      const result = await apiPost<{ status?: string }>(
        '/api/builder-experience/approval',
        { action: 'confirm-publication', approvalId }
      );
      setStatus(result.status ?? 'verifying');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Publication verification">
      <p>
        The publication is committed. Retry its verification using the existing
        receipt.
      </p>
      {status === 'verifying' ? (
        <button type="button" disabled={busy} onClick={retry}>
          {busy ? 'Verifying…' : 'Retry verification'}
        </button>
      ) : null}
      <p role="status">
        {error
          ? 'Verification unavailable. You can retry verification.'
          : status}
      </p>
    </section>
  );
}
