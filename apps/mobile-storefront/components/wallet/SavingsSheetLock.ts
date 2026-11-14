import { useContext, useEffect } from 'react';
import { SavingsSheetLockContext } from './SavingsSheetLockContext';

/**
 * While `locked` is true the savings sheet can't be swiped down, closed from
 * its backdrop or closed with the system back, so a save in flight can't be
 * abandoned and started again. Outside a savings sheet it does nothing.
 */
export function useSavingsSheetLock(locked: boolean) {
  const setLocked = useContext(SavingsSheetLockContext);
  useEffect(() => {
    if (!setLocked) return;
    setLocked(locked);
    return () => setLocked(false);
  }, [locked, setLocked]);
}
