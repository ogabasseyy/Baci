import { useContext } from 'react';
import { SearchComparisonIntentContext } from './SearchComparisonIntentContext';

export function useSearchComparisonIntent() {
  return useContext(SearchComparisonIntentContext);
}
