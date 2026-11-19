import { createContext } from 'react';

/** Lets a step inside the savings sheet stop it closing while it saves. */
export const SavingsSheetLockContext = createContext<
  ((locked: boolean) => void) | null
>(null);
