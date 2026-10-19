import type {
  CartCommand,
  CartInputLine,
  CartSnapshot,
} from '@baci/shared/cart';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import { nativeCartInput } from './display';
import { NativeCartError } from './shared-cart-client';
export function snapshotInputLines(snapshot: CartSnapshot): CartInputLine[] {
  return snapshot.lines.map((line) => ({
    item: line.item,
    quantity: line.quantity,
    voucherToken: line.voucherToken,
    voucherAwardId: line.voucherAwardId,
    negotiatedUnitPriceMinor: line.negotiatedUnitPriceMinor,
    negotiationStatus: line.negotiationStatus,
    hasAssurance: line.hasAssurance,
  }));
}
export function nativeWriteCommand(
  action: SharedCartWrite,
  snapshot: CartSnapshot
): CartCommand | null {
  if (action.type === 'add') {
    const line = nativeCartInput(action.item);
    return { type: 'add', ...line };
  }
  if (action.type === 'clear') return { type: 'clear' };
  if (action.type === 'assurance') {
    const line = snapshot.lines.find((entry) => entry.id === action.id);
    if (!line) return null;
    return {
      type: 'set_assurance',
      lineId: action.id,
      hasAssurance: !line.hasAssurance,
    };
  }
  if (action.type === 'remove' || action.type === 'quantity') {
    if (!snapshot.lines.some((line) => line.id === action.id)) return null;
    if (action.type === 'remove' || action.quantity <= 0)
      return { type: 'remove', lineId: action.id };
    return {
      type: 'set_quantity',
      lineId: action.id,
      quantity: action.quantity,
    };
  }
  if (action.type === 'negotiate' || action.type === 'clear_negotiation') {
    const index = snapshot.lines.findIndex((line) => line.id === action.id);
    if (index < 0) return null;
    const price =
      action.type === 'negotiate' ? Math.round(action.price * 100) : null;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0))
      throw new NativeCartError('invalid_request');
    return {
      type: 'set_negotiated_price',
      lineId: action.id,
      negotiatedUnitPriceMinor: price,
    };
  }
  if (action.type === 'negotiate_group') {
    const total = Math.round(action.total * 100);
    const original = snapshot.lines.reduce(
      (sum, line) => sum + line.lineTotalMinor,
      0
    );
    if (!Number.isSafeInteger(total) || total < 0 || original <= 0)
      throw new NativeCartError('invalid_request');
    return {
      type: 'replace',
      lines: snapshotInputLines(snapshot).map((line, index) => ({
        ...line,
        negotiatedUnitPriceMinor: Math.round(
          ((snapshot.lines[index].negotiatedUnitPriceMinor ??
            snapshot.lines[index].unitPriceMinor) *
            total) /
            original
        ),
        negotiationStatus: 'accepted',
      })),
    };
  }
  return null;
}
