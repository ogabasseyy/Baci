import { createContext } from 'react';

/**
 * Lets a PIN step shown inside the savings sheet register how to cancel
 * itself, so closing that sheet (swipe down, backdrop, Android Back) also
 * settles the waiting PIN request instead of leaving it to reappear as a
 * standalone sheet. Null outside the savings sheet.
 */
export const SavingsSheetPinCancelContext = createContext<
  ((cancel: (() => void) | null) => void) | null
>(null);

/**
 * Lets the embedded PIN step tell the savings sheet how tall it needs to be
 * (0 = no PIN step). The sheet fits itself through a real snap point: a
 * temporary snapToPosition target reads as "closed" to Gorhom, which then
 * closed the whole sheet and cancelled the PIN request.
 */
export const SavingsSheetPinHeightContext = createContext<
  ((height: number) => void) | null
>(null);
