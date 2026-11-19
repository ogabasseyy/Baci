'use client';
import { useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';

export function useOxygenPlanAcceptance() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function accept(
    workflowId: string,
    bookingReference: string,
    readSaved: () => Promise<void>
  ) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const latest = await fetchWithCsrf(
        `/api/payments/oxygen/workflows/actions?workflowId=${encodeURIComponent(workflowId)}`,
        { cache: 'no-store' }
      );
      if (!latest.ok) throw new Error('Unavailable');
      const snapshot = oxygenRuntimeSnapshotSchema.parse(await latest.json());
      if (snapshot.workflowId !== workflowId) throw new Error('Unavailable');
      const response = await fetchWithCsrf(
        '/api/payments/oxygen/plans/accept',
        {
          method: 'POST',
          cache: 'no-store',
          body: JSON.stringify({
            workflowId,
            bookingReference,
            version: snapshot.version,
          }),
        }
      );
      if (!response.ok) throw new Error('Unavailable');
      await readSaved();
      return true;
    } catch {
      setError(
        'Your selected plan could not be confirmed. Please check it and try again.'
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { accept, busy, error };
}
