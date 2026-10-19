'use client';

import { useEffect, useState } from 'react';
import { piggyvestFundingDisplaySchema } from '@/schemas/piggyvest-funding-display';
import type { FundingDetailsProps } from './funding-details.types';

type Load = (requestKey: string, signal: AbortSignal) => Promise<unknown>;

export function useFundingDetails(
  requestKey: string | null,
  load: Load
): FundingDetailsProps {
  const [result, setResult] = useState<{
    key: string | null;
    load: Load;
    view: FundingDetailsProps;
  }>({ key: requestKey, load, view: { status: 'loading' } });
  if (result.key !== requestKey || result.load !== load) {
    setResult({
      key: requestKey,
      load,
      view: { status: requestKey ? 'loading' : 'unavailable' },
    });
  }
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    let active = true;
    const update = (view: FundingDetailsProps) => {
      if (active) setResult({ key: requestKey, load, view });
    };
    void Promise.resolve()
      .then(() => {
        if (!active) return undefined;
        return load(requestKey, controller.signal);
      })
      .then((response) => {
        if (!active) return;
        const parsed = piggyvestFundingDisplaySchema.safeParse(response);
        update(parsed.success ? parsed.data : { status: 'unavailable' });
      })
      .catch(() => update({ status: 'unavailable' }));
    return () => {
      active = false;
      controller.abort();
    };
  }, [requestKey, load]);
  if (!requestKey) return { status: 'unavailable' };
  if (result.key !== requestKey || result.load !== load)
    return { status: 'loading' };
  return result.view;
}
