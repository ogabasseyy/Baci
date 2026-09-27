import { type RefObject, useEffect } from 'react';

export function useRepairPickupBack(
  navigationBackRef: RefObject<(() => void) | null> | undefined,
  canEdit: boolean,
  inFlight: RefObject<boolean>,
  onBack: () => void
) {
  useEffect(() => {
    if (!navigationBackRef) return;
    navigationBackRef.current = () => {
      if (canEdit && !inFlight.current) onBack();
    };
    return () => {
      navigationBackRef.current = null;
    };
  }, [navigationBackRef, canEdit, inFlight, onBack]);
}
