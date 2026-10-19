import type { CartSnapshot } from '@baci/shared/cart';
import type { createCartCommandCoordinator } from './command-coordinator';
import type { NativeCartControllerOptions } from './controller-options';
import {
  type NativeAccountLinkInput,
  NativeCartError,
} from './shared-cart-client';

type Coordinator = ReturnType<typeof createCartCommandCoordinator>;

/**
 * Account and checkout-review operations for the native cart
 * controller: saved-cart adoption reads, account linking, and the
 * bound checkout review. Kept separate so the controller module stays
 * within the repository file-size boundary.
 */
export function createNativeCartAccountOps(deps: {
  accept: (next: CartSnapshot) => Promise<void>;
  assertCurrent: () => void;
  coordinator: Coordinator;
  ensureCart: () => Promise<CartSnapshot>;
  options: NativeCartControllerOptions;
  serial: <T>(run: () => Promise<T>) => Promise<T>;
}) {
  const { options } = deps;
  return {
    savedCart: () =>
      deps.serial(async () => {
        if (!options.client.savedAccountCart)
          throw new NativeCartError('temporarily_unavailable');
        // A fresh install holds no proof: bootstrap one (without
        // creating a cart) so the account read can authorize.
        if (!(await options.client.context())) {
          await options.client.bootstrap();
          deps.assertCurrent();
        }
        const reply = await options.client.savedAccountCart();
        deps.assertCurrent();
        return reply.cart ?? null;
      }),
    linkAccount: (input: NativeAccountLinkInput) =>
      deps.serial(async () => {
        // Adopting the saved cart needs no destination cart; creating
        // an empty one first would replace the saved-cart pointer.
        if (input.choice !== 'use_saved') await deps.ensureCart();
        options.status('pending');
        await deps.accept(await deps.coordinator.linkAccount(input));
      }),
    reviewCheckout: (operationId: string) =>
      deps.serial(async () => {
        const current = await deps.ensureCart();
        if (!options.client.prepareCheckout)
          throw new NativeCartError('temporarily_unavailable');
        options.status('pending');
        try {
          return await options.client.prepareCheckout({
            cartId: current.cartId,
            expectedVersion: current.version,
            operationId,
          });
        } finally {
          if (options.isCurrent()) options.status('ready');
        }
      }),
  };
}
