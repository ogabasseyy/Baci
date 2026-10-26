'use client';
import { useEffect, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import type { InitialPublicationApproval } from '@/lib/website-builder/owner-publication-view';
import {
  type PublicationConfirmationView,
  publicationConfirmationSchema,
} from '@/schemas/builder-publication';
import { ApprovalPreview } from './approval-preview';
export function ApprovalClient({
  intentId,
  initial,
}: {
  intentId: string;
  initial?: InitialPublicationApproval;
}) {
  const [loaded, setLoaded] = useState<{
    id: string;
    view: PublicationConfirmationView;
  } | null>(initial?.view ? { id: intentId, view: initial.view } : null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [pending, setPending] = useState(false);
  const [approved, setApproved] = useState(false);
  const [signedOut, setSignedOut] = useState(initial?.signedOut ?? false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (reload === 0 && initial) return;
    const controller = new AbortController();
    setLoaded(null);
    setError(null);
    setApproved(false);
    setSignedOut(false);
    void fetch(
      `/api/builder-publication?intent=${encodeURIComponent(intentId)}&refresh=${reload}`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      }
    )
      .then(async (response) => {
        if (response.status === 401) {
          setSignedOut(true);
          throw Error('Sign in to Baci to review this publication.');
        }
        if (!response.ok)
          throw Error(
            'Could not load this approval. Request a new approval or open Baci.'
          );
        const view = publicationConfirmationSchema.parse(await response.json());
        if (!controller.signal.aborted) setLoaded({ id: intentId, view });
      })
      .catch((_cause) => {
        if (!controller.signal.aborted)
          setError(
            'Could not load this approval. Sign in or request a fresh approval in Baci.'
          );
      });
    return () => controller.abort();
  }, [intentId, reload, initial]);
  const view = loaded?.id === intentId ? loaded.view : null;
  const send = async (action: 'confirm' | 'retry', receiptId?: string) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithCsrf('/api/builder-publication', {
        method: 'POST',
        body: JSON.stringify(
          action === 'confirm' ? { action, intentId } : { action, receiptId }
        ),
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok)
        throw Error(
          'Publication could not be confirmed. Refresh its status before trying again.'
        );
      setReload((value) => value + 1);
    } catch {
      setError(
        'The request outcome is uncertain. Refresh status before trying again.'
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <main style={{ maxWidth: 1200, margin: 'auto', padding: 24 }}>
      <h1>Review homepage publication</h1>
      {error ? <p role="alert">{error}</p> : null}
      {signedOut ? (
        <a
          href={`/login?redirect=${encodeURIComponent(`/builder/approve?intent=${intentId}`)}`}
        >
          Sign in to Baci
        </a>
      ) : null}
      {!view && !error ? (
        <p role="status">Loading the exact homepage revision…</p>
      ) : null}
      {view?.kind === 'receipt' ? (
        <section aria-label="Publication status">
          <h2>
            {view.receipt.status === 'live'
              ? 'Homepage is live'
              : view.receipt.status === 'superseded'
                ? 'A newer public revision exists'
                : 'Publication committed; checking delivery'}
          </h2>
          <p>Approved revision: {view.receipt.version}</p>
          {view.receipt.status === 'live' ? (
            <a href={view.receipt.publicUrl} rel="noreferrer">
              View homepage
            </a>
          ) : null}
          {view.receipt.status === 'verifying' ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void send('retry', view.receipt.receiptId)}
            >
              Retry delivery check
            </button>
          ) : null}
        </section>
      ) : null}
      {view?.kind === 'approval' ? (
        <section aria-label="Exact publication approval">
          <p>
            Publish this homepage’s layout, text and theme to{' '}
            <strong>{view.destinationUrl}</strong>.
          </p>
          <p>Revision: {view.version}</p>
          {view.preview ? (
            <ApprovalPreview preview={view.preview}>
              {view.canConfirm ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (approved && !pending) void send('confirm');
                  }}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(event) => setApproved(event.target.checked)}
                    />
                    I approve publishing this homepage revision to this address.
                  </label>
                  <button type="submit" disabled={!approved || pending}>
                    {pending
                      ? 'Checking approval…'
                      : 'Publish approved homepage'}
                  </button>
                </form>
              ) : (
                <p role="alert">
                  {view.reason === 'stale'
                    ? 'The draft has changed. Request a new approval.'
                    : view.reason === 'expired'
                      ? 'This approval expired. Request a new approval.'
                      : 'Complete the launch requirements before publishing.'}
                </p>
              )}
            </ApprovalPreview>
          ) : (
            <p role="alert">
              This homepage cannot be previewed safely. Open the Baci editor to
              continue.
            </p>
          )}
          {view.preview && !view.preview.readiness.ready ? (
            <ul>
              {view.preview.readiness.missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <p>
            <a href="https://usebaci.com/dashboard">
              Complete launch requirements in Baci
            </a>
          </p>
        </section>
      ) : null}
      <p>
        <a href="https://usebaci.com/builder">Open Baci editor</a>
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh status
      </button>
    </main>
  );
}
