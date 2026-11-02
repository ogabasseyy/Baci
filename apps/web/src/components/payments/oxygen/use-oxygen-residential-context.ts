'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { fetchWithCsrf } from '@/lib/api-client';

const schema = z.object({
  address: z.record(z.string(), z.string().max(200)),
  source: z.enum(['saved', 'checkout']).default('checkout'),
});
export function useOxygenResidentialContext(workflowId?: string) {
  const [result, setResult] = useState<{
    id?: string;
    address: Record<string, string>;
    source?: 'saved' | 'checkout';
  }>();
  useEffect(() => {
    if (!workflowId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchWithCsrf(
          `/api/payments/oxygen/residential-context?workflowId=${workflowId}`,
          { cache: 'no-store', signal: controller.signal }
        );
        if (!response.ok) throw new Error('Unavailable');
        const body = schema.parse(await response.json());
        if (!controller.signal.aborted)
          setResult({
            id: workflowId,
            address: body.address,
            source: body.source,
          });
      } catch {
        if (!controller.signal.aborted)
          setResult({ id: workflowId, address: {} });
      }
    })();
    return () => controller.abort();
  }, [workflowId]);
  return {
    fromCheckout: result?.source === 'checkout',
    ready: !workflowId || result?.id === workflowId,
    address: result && result.id === workflowId ? result.address : {},
  };
}
