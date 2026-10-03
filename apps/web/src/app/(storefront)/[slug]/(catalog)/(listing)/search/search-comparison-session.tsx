'use client';
import { createContext, type ReactNode, useContext, useState } from 'react';

const ComparisonIntent = createContext({
  active: false,
  activate: () => {
    /* Outside search, comparison actions stay hidden. */
  },
});

/** Saved selections alone must not surface comparison actions in a new search. */
export function SearchComparisonSession({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [intent, setIntent] = useState({ scope, active: false });
  if (intent.scope !== scope) setIntent({ scope, active: false });
  return (
    <ComparisonIntent.Provider
      value={{
        active: intent.scope === scope && intent.active,
        activate: () => setIntent({ scope, active: true }),
      }}
    >
      {children}
    </ComparisonIntent.Provider>
  );
}
export function useSearchComparisonIntent() {
  return useContext(ComparisonIntent);
}
