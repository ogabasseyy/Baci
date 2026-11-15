import { createContext } from 'react';

/**
 * Lets the embedded PIN step tell the savings sheet how tall it needs to be
 * (0 = no PIN step). The sheet fits itself through a real snap point: a
 * temporary snapToPosition target reads as "closed" to Gorhom, which then
 * closed the whole sheet and cancelled the PIN request.
 */
export const SavingsSheetPinHeightContext = createContext<
  ((height: number) => void) | null
>(null);
