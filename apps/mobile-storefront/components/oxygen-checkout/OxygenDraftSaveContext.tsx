import { createContext } from 'react';

/** Field blur asks the application owner to persist its current draft. */
export const OxygenDraftSaveContext = createContext<(() => void) | undefined>(
  undefined
);
