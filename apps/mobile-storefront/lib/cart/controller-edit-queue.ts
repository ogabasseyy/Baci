import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import { NativeCartError } from './native-cart-error';
import {
  type createPendingEdits,
  isPredictableEdit,
  type PendingEdit,
} from './pending-edits';

/** How a rejected edit ended: undone for certain, or the server may still apply it. */
export type EditOutcome = 'rolled_back' | 'unconfirmed';

export function isIndeterminateFailure(error: unknown): boolean {
  return (
    error instanceof NativeCartError &&
    (error.indeterminate || error.code === 'temporarily_unavailable')
  );
}

interface EditQueueDeps {
  edits: ReturnType<typeof createPendingEdits>;
  /** True only while a confirmed, unfinished cart is held, the one case a screen prediction is safe. */
  live(): boolean;
  serial<T>(run: () => Promise<T>): Promise<T>;
  run(action: SharedCartWrite): Promise<void>;
  refresh(): Promise<void>;
  onFailed?(
    action: SharedCartWrite,
    error: unknown,
    outcome: EditOutcome
  ): void;
}

/**
 * Puts a shopper edit on screen at once and queues it on the controller's own
 * single queue at the moment of the tap. Checkout, refresh and every other
 * controller operation line up behind it, so none can run on a cart that is
 * missing an edit the shopper already sees.
 */
export function createEditQueue(deps: EditQueueDeps) {
  return function enqueue(action: SharedCartWrite): Promise<void> {
    const edit: PendingEdit | null =
      isPredictableEdit(action) && deps.live()
        ? deps.edits.begin(action)
        : null;
    return deps.serial(async () => {
      try {
        const resolved = deps.edits.resolve(action);
        if (resolved) await deps.run(resolved);
        // The line this tap targeted never reached the cart.
        else
          deps.onFailed?.(
            action,
            new NativeCartError('invalid_item'),
            'rolled_back'
          );
      } catch (error) {
        const outcome: EditOutcome = isIndeterminateFailure(error)
          ? 'unconfirmed'
          : 'rolled_back';
        // The write may have landed; settle against the server inside this
        // slot so nothing else (checkout) runs on a guess.
        if (outcome === 'unconfirmed') {
          if (edit) deps.edits.markLanded(edit);
          await deps.refresh().catch(() => undefined);
        }
        deps.onFailed?.(action, error, outcome);
        throw error;
      } finally {
        if (edit) deps.edits.settle(edit);
      }
    });
  };
}
