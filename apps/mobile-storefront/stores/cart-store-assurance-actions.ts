import type { StoreApi } from 'zustand';
import type { CartState } from './cart-store-state';

export function createAssuranceActions(
  set: StoreApi<CartState>['setState'],
  forwardToggle?: (id: string) => unknown
): Pick<CartState, 'toggleAssurance' | 'reconcilePendingAssuranceLines'> {
  return {
    toggleAssurance: (id) => {
      // A shared-cart writer owns the lines: forward instead of editing
      // the parked legacy cart (canonical writer fencing).
      if (forwardToggle?.(id)) return;
      set((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                hasAssurance: !item.hasAssurance,
                // An explicit toggle wins over any later settings
                // reconciliation: the shopper has chosen.
                assurancePendingSetting: undefined,
              }
            : item
        ),
      }));
    },

    reconcilePendingAssuranceLines: (shippingInsuranceEnabled) => {
      set((state) => {
        if (
          !state.items.some((item) => item.assurancePendingSetting === true)
        ) {
          return state;
        }
        return {
          items: state.items.map((item) =>
            item.assurancePendingSetting === true
              ? {
                  ...item,
                  // Falsy (disabled OR still-unknown-but-cleared) strips a
                  // pending-add true to opted-out: no known merchant
                  // service exists to cover the line, and the value was
                  // never an explicit shopper toggle — just a default.
                  hasAssurance: shippingInsuranceEnabled === true,
                  assurancePendingSetting: undefined,
                }
              : item
          ),
        };
      });
    },
  };
}
