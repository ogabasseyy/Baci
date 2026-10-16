import type { StoreApi } from 'zustand';
import type { CartState } from './cart-store-state';

export function createAssuranceActions(
  set: StoreApi<CartState>['setState']
): Pick<CartState, 'toggleAssurance' | 'reconcilePendingAssuranceLines'> {
  return {
    toggleAssurance: (id) => {
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
                  hasAssurance: shippingInsuranceEnabled
                    ? true
                    : item.hasAssurance,
                  assurancePendingSetting: undefined,
                }
              : item
          ),
        };
      });
    },
  };
}
