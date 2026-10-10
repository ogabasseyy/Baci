import { createContext } from 'react';

export const SearchComparisonIntentContext = createContext({
  active: false,
  activate: () => {
    /* Outside search, comparison actions stay hidden. */
  },
});
