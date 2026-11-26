'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api-client';
/** Reconciles the existing receipt; never requests a new publication intent. */
export function ExperienceVerificationRetry({
  approvalId,
}: {
  approvalId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (status !== 'verifying') return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      approval: approvalId,
      kind: 'lifecycle',
    });
    async function check() {
      const receipt = await apiGet<{ status?: string }>(
        `/api/builder-experience/approval?${query}`,
        { signal: controller.signal, cache: 'no-store' }
      ).catch(() => null);
      if (controller.signal.aborted) return;
      if (receipt?.status && receipt.status !== 'verifying') {
        setError(false);
        setStatus(receipt.status);
      } else {
        timer = setTimeout(check, 5000);
      }
    }
    let timer = setTimeout(check, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [approvalId, status]);
  async function retry() {
    if (busy || status !== 'verifying') return;
    setBusy(true);
    setError(false);
    try {
      const result = await apiPost<{ status?: string }>(
        '/api/builder-experience/approval',
        { action: 'confirm-publication', approvalId }
      );
      setStatus((current) =>
        current === 'verifying' ? (result.status ?? current) : current
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Publication verification">
      <p>
        The publication is committed. This page checks the existing verification
        receipt. Retry if the verifier was interrupted.
      </p>
      {status === 'verifying' ? (
        <button type="button" disabled={busy} onClick={retry}>
          {busy ? 'Verifying…' : 'Retry verification'}
        </button>
      ) : null}
      <p role="status">
        {error && status === 'verifying'
          ? 'Verification unavailable. You can retry verification.'
          : status}
      </p>
    </section>
  );
}
