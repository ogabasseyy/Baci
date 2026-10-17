import { type ReactNode, useState } from 'react';
import { SearchComparisonIntentContext } from './SearchComparisonIntentContext';

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
    <SearchComparisonIntentContext.Provider
      value={{
        active: intent.scope === scope && intent.active,
        activate: () => setIntent({ scope, active: true }),
      }}
    >
      {children}
    </SearchComparisonIntentContext.Provider>
  );
}
