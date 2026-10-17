import {
  type CartMergeResolution,
  type CartSnapshot,
  planCartMerge,
} from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import { nativeCartInput } from './display';

/** Local prices are preview metadata only; the replacement command is repriced by the server. */
export function planNativeLegacyMerge(
  saved: CartSnapshot,
  legacy: CartItem[],
  resolutions: CartMergeResolution[] = []
) {
  return planCartMerge(
    saved,
    {
      ...saved,
      estimatedTotals: true,
      lines: legacy.map((item) => ({
        ...nativeCartInput(item),
        id: item.id,
        unitPriceMinor: Math.round(item.price * 100),
        lineTotalMinor: Math.round(item.price * 100) * item.quantity,
      })),
    },
    resolutions
  );
}
