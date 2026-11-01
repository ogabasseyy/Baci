'use client';
import { useEffect, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type OxygenApprovalCodeWindow,
  oxygenApprovalCodeResponseSchema,
} from '@/schemas/oxygen-approval-code';
export function useOxygenApprovalWindow(workflowId: string, reference: string) {
  const [window, setWindow] = useState<OxygenApprovalCodeWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    async function load() {
      try {
        const response = await fetchWithCsrf(
          `/api/payments/oxygen/approval-code?workflowId=${encodeURIComponent(workflowId)}&revision=${revision}`,
          { cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Unavailable');
        const data = oxygenApprovalCodeResponseSchema.parse(
          await response.json()
        );
        if (data.window && data.window.bookingReference !== reference)
          throw new Error('Reference mismatch');
        if (current) {
          setWindow(data.window);
          setError('');
        }
      } catch {
        if (current) {
          setWindow(null);
          setError(
            'We could not confirm when this code was sent. Check its status or request a new code.'
          );
        }
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [workflowId, reference, revision]);
  return {
    window: window?.bookingReference === reference ? window : null,
    loading,
    error,
    reload: () => setRevision((value) => value + 1),
  };
}
