import type { CartItem } from '@/stores/cart-store.types';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import type { NativeCartControllerOptions } from './controller-options';
import type { pendingCartRequest } from './pending-request';

/**
 * A remove/quantity/clear on a purely local cart (no shared cart exists yet)
 * only needs the local lines fixed; creating a server cart for it would be
 * wrong. Returns true when it handled the edit.
 */
export async function editLocalCartOnly(
  options: NativeCartControllerOptions,
  receipts: typeof pendingCartRequest,
  action: SharedCartWrite,
  /** A shared cart, finished cart or pending choice is already in play. */
  engaged: boolean
): Promise<boolean> {
  const legacy = options.getLegacy();
  if (
    engaged ||
    legacy.items.length === 0 ||
    legacy.sharedCartRef ||
    !options.repairLegacy ||
    (action.type !== 'clear' &&
      action.type !== 'remove' &&
      action.type !== 'quantity') ||
    (await options.client.context())?.cartId ||
    (await receipts.read(options.merchantId))
  )
    return false;
  const items: CartItem[] =
    action.type === 'clear'
      ? []
      : legacy.items.flatMap((item) => {
          if (item.id !== action.id) return [item];
          return action.type === 'remove' || action.quantity <= 0
            ? []
            : [{ ...item, quantity: action.quantity }];
        });
  options.repairLegacy(items);
  options.status('ready');
  return true;
}

/** Runs one edit: local-only fixes stay local, everything else goes to the server writer. */
export function createEditRunner(
  options: NativeCartControllerOptions,
  receipts: typeof pendingCartRequest,
  engaged: () => boolean,
  write: (action: SharedCartWrite) => Promise<void>
) {
  return async (action: SharedCartWrite): Promise<void> => {
    if (await editLocalCartOnly(options, receipts, action, engaged())) return;
    await write(action);
  };
}
