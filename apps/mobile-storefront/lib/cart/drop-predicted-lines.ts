import { useCartStore } from '@/stores/cart-store';
import { stripPendingLines } from './pending-edits';

/** Edits still queued when a controller dies never settle; clear their lines from the store. */
export function dropPredictedLines(): void {
  const { items } = useCartStore.getState();
  const kept = stripPendingLines(items);
  if (kept !== items) useCartStore.setState({ items: kept });
}
