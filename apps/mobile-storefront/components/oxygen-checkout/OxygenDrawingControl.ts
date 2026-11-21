import { createContext, useContext } from 'react';

/** Lock the parent scroll view only during an active signature stroke. */
export const OxygenDrawingControl = createContext<
  ((drawing: boolean) => void) | null
>(null);
export function useOxygenDrawingControl() {
  return useContext(OxygenDrawingControl);
}
