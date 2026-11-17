import { useState } from 'react';

/**
 * The savings sheet's measured height, never shrinking while an add is in
 * flight: the add hides a few links, and shrinking the sheet under the PIN
 * step made it bounce. Released as soon as the add settles.
 */
export function useHeldWhileAdding(
  isAdding: boolean,
  measured: number | undefined
) {
  const [held, setHeld] = useState<number | undefined>(undefined);
  const [wasAdding, setWasAdding] = useState(isAdding);
  // Adjusted during render (React's "store information from previous
  // renders" pattern): the height in effect when the add started is kept.
  if (wasAdding !== isAdding) {
    setWasAdding(isAdding);
    setHeld(isAdding ? measured : undefined);
  }
  if (!isAdding || held === undefined || measured === undefined)
    return measured;
  return Math.max(held, measured);
}
