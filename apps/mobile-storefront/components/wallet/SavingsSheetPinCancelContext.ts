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
