import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import type { NativeCartControllerOptions } from './controller-options';
import { NativeCartError } from './native-cart-error';
import {
  type createPendingEdits,
  isPredictableEdit,
  type PendingEdit,
} from './pending-edits';

/** How a rejected edit ended: undone for certain, or the server may still apply it. */
export type EditOutcome = 'rolled_back' | 'unconfirmed';

export function isIndeterminateFailure(error: unknown): boolean {
  // A retained request receipt (checked separately) covers transient codes.
  return error instanceof NativeCartError && error.indeterminate;
}

interface EditQueueDeps {
  edits: ReturnType<typeof createPendingEdits>;
  /** True only while a confirmed, unfinished cart is held, the one case a screen prediction is safe. */
  live(): boolean;
  serial<T>(run: () => Promise<T>): Promise<T>;
  run(action: SharedCartWrite): Promise<void>;
  refresh(): Promise<void>;
  /** Whether this edit's own command reached the network. */
  transmission: { reset(): void; sent(): boolean };
  /** A request is still saved for retry, so it may yet be applied. */
  hasRetainedRequest(): Promise<boolean>;
  notify: Pick<
    NativeCartControllerOptions,
    'onWriteFailed' | 'onWriteSucceeded'
  >;
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
    const unpin = deps.edits.pin(action);
    let started = false;
    return deps
      .serial(async () => {
        started = true;
        try {
          deps.transmission.reset();
          if (edit) deps.edits.startRun(edit);
          const resolved = deps.edits.resolve(action);
          if (resolved) {
            await deps.run(resolved);
            deps.notify.onWriteSucceeded?.();
          }
          // The line this tap targeted never reached the cart.
          else
            deps.notify.onWriteFailed?.(
              action,
              new NativeCartError('invalid_item'),
              'rolled_back'
            );
        } catch (error) {
          // Blocked behind an earlier saved request: this edit was never sent,
          // so recovering that request says nothing about it.
          const blocked =
            error instanceof NativeCartError &&
            error.code === 'pending_operation';
          const outcome: EditOutcome =
            !blocked &&
            (isIndeterminateFailure(error) ||
              (await deps.hasRetainedRequest().catch(() => true)))
              ? 'unconfirmed'
              : 'rolled_back';
          // The write may have landed; settle against the server inside this
          // slot so nothing else (checkout) runs on a guess.
          let recovered = false;
          // Recovering a lost cart creation says nothing about an edit never sent.
          const unsent = outcome === 'unconfirmed' && !deps.transmission.sent();
          if (outcome === 'unconfirmed') {
            if (edit && !unsent) deps.edits.markLanded(edit);
            const refreshed = await deps.refresh().then(
              () => true,
              () => false
            );
            // Server truth is on screen and nothing is queued for retry: nothing left to explain.
            recovered =
              !unsent &&
              refreshed &&
              !(await deps.hasRetainedRequest().catch(() => true));
          }
          if (recovered) deps.notify.onWriteSucceeded?.();
          else
            deps.notify.onWriteFailed?.(
              action,
              error,
              unsent ? 'rolled_back' : outcome
            );
          throw error;
        } finally {
          unpin();
          if (edit) deps.edits.settle(edit);
        }
      })
      .finally(() => {
        // The queue refused the slot (superseded controller): release here.
        if (started) return;
        unpin();
        if (edit) deps.edits.settle(edit);
      });
  };
}
