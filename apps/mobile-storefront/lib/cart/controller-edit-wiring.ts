import type { CartSnapshot } from '@baci/shared/cart';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import { createEditQueue } from './controller-edit-queue';
import { createEditRunner } from './controller-legacy-edit';
import type { NativeCartControllerOptions } from './controller-options';
import type { pendingCartRequest } from './pending-request';

type QueueDeps = Parameters<typeof createEditQueue>[0];

/** Joins the shopper edit queue to the controller's single queue and write path. */
export function wireEditQueue(deps: {
  edits: QueueDeps['edits'];
  options: NativeCartControllerOptions;
  receipts: typeof pendingCartRequest;
  serial: QueueDeps['serial'];
  refresh: QueueDeps['refresh'];
  transmission: QueueDeps['transmission'];
  write(action: SharedCartWrite): Promise<void>;
  /** Whether a cart is held, finished, or waiting on a pairing choice. */
  state(): {
    snapshot: CartSnapshot | null;
    terminal: boolean;
    incoming: CartSnapshot | null;
  };
}) {
  const { options, receipts, state } = deps;
  return createEditQueue({
    edits: deps.edits,
    live: () => {
      const s = state();
      return Boolean(s.snapshot) && !s.terminal && !s.incoming;
    },
    serial: deps.serial,
    refresh: deps.refresh,
    transmission: deps.transmission,
    hasRetainedRequest: () => receipts.read(options.merchantId).then(Boolean),
    notify: options,
    run: createEditRunner(
      options,
      receipts,
      () => {
        const s = state();
        return Boolean(s.snapshot) || s.terminal || Boolean(s.incoming);
      },
      deps.write
    ),
  });
}
