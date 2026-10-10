'use client';
import { useContext } from 'react';
import { SearchComparisonIntentContext } from './search-comparison-intent-context';

export function useSearchComparisonIntent() {
  return useContext(SearchComparisonIntentContext);
}
