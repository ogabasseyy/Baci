import type { CartCommand, CartSnapshot } from '@baci/shared/cart';
import type { PublicCart, PublicCartCommand } from '@baci/shared/experience';
import type { Product } from '@/lib/products';
import type { SharedCartIntent } from './shared-cart-state';
export const publicCartSnapshot = (s: CartSnapshot): PublicCart => ({
  version: s.version,
  currency: s.currency,
  total: s.totalMinor / 100,
  lines: s.lines.map((l) => ({
    lineId: l.id,
    productId: l.item.productId,
    variantId: l.item.variantId,
    quantity: l.quantity,
    price: l.unitPriceMinor / 100,
  })),
});
export function engineCommand(c: PublicCartCommand): CartCommand {
  if (c.kind === 'add')
    return {
      type: 'add',
      item: {
        productId: c.productId,
        ...(c.variantId ? { variantId: c.variantId } : {}),
        ...(c.condition
          ? {
              condition: c.condition as
                | 'new'
                | 'used'
                | 'open_box'
                | 'refurbished',
            }
          : {}),
        ...(c.options ? { options: c.options } : {}),
      },
      quantity: c.quantity,
    };
  return c.kind === 'remove'
    ? { type: 'remove', lineId: c.lineId }
    : { type: 'set_quantity', lineId: c.lineId, quantity: c.quantity };
}
export function publicCommand(c: CartCommand): PublicCartCommand | null {
  if (c.type === 'add') return { kind: 'add', ...c.item, quantity: c.quantity };
  if (c.type === 'remove') return { kind: 'remove', lineId: c.lineId };
  if (c.type === 'set_quantity')
    return { kind: 'set_quantity', lineId: c.lineId, quantity: c.quantity };
  return null;
}

export function sharedCartIntent(
  command: PublicCartCommand,
  product: Product | null,
  id: string
): SharedCartIntent {
  return command.kind === 'add'
    ? {
        kind: 'add',
        tempId: `experience:${id}`,
        product: product as Product,
        quantity: command.quantity,
        input: {
          item: (
            engineCommand(command) as Extract<CartCommand, { type: 'add' }>
          ).item,
          quantity: command.quantity,
        },
      }
    : command.kind === 'remove'
      ? {
          kind: 'remove',
          target: { kind: 'lineId', lineId: command.lineId },
        }
      : {
          kind: 'set_quantity',
          target: { kind: 'lineId', lineId: command.lineId },
          quantity: command.quantity,
        };
}
