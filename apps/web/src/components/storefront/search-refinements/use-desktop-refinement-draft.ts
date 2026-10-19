'use client';
import {
  emptySearchRefinements,
  parseSearchRefinements,
  type RefinementParams,
  type SearchRefinements,
} from '@baci/shared/lib';
import { useEffect, useEffectEvent, useState } from 'react';
import { createRefinementDraft } from './search-refinement-draft';
export function useDesktopRefinementDraft(
  criteria: SearchRefinements,
  onHistory: () => void
) {
  const historyRestored = useEffectEvent(onHistory);
  const [desktopDraft, setDesktopDraft] = useState(() =>
    createRefinementDraft(criteria)
  );
  const committedKey = JSON.stringify(criteria);
  const [previousKey, setPreviousKey] = useState(committedKey);
  const priceKey = `${criteria.minPrice}:${criteria.maxPrice}`;
  const [previousPriceKey, setPreviousPriceKey] = useState(priceKey);
  if (previousKey !== committedKey) {
    setPreviousKey(committedKey);
    setPreviousPriceKey(priceKey);
    setDesktopDraft({
      ...createRefinementDraft(criteria),
      ...(priceKey === previousPriceKey
        ? { minimum: desktopDraft.minimum, maximum: desktopDraft.maximum }
        : {}),
    });
  }
  useEffect(() => {
    const restore = () => {
      const search = new URLSearchParams(window.location.search);
      const params: RefinementParams = {};
      for (const key of search.keys()) {
        const values = search.getAll(key);
        params[key] = values.length > 1 ? values : values[0];
      }
      const parsed = parseSearchRefinements(params);
      setDesktopDraft(
        createRefinementDraft(
          parsed.success ? parsed.data : emptySearchRefinements()
        )
      );
      historyRestored();
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  return { desktopDraft, setDesktopDraft };
}
