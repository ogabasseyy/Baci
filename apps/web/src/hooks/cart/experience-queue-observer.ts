import type { CartSnapshot } from '@baci/shared/cart';
import type { Dispatch } from 'react';
import type { SharedCartMutationResult } from './shared-cart-client';
import type { SharedCartExperienceEntry } from './shared-cart-experience-types';
import type { SharedCartAction } from './shared-cart-state';
/** Receipt/admission observation only. The existing send queue remains the sole writer. */
export function createExperienceQueueObserver(
  entry: SharedCartExperienceEntry | undefined,
  deps: {
    generation: number;
    operationId: string;
    isCurrent: () => boolean;
    dispatch: Dispatch<SharedCartAction>;
  }
) {
  if (!entry)
    return {
      admit: deps.isCurrent,
      prepare: async (_snapshot: CartSnapshot) => true,
      finish: (_result: SharedCartMutationResult) => deps.isCurrent(),
    };
  const cancel = () => {
    entry.deny();
    deps.dispatch({
      type: 'command/cancel',
      generation: deps.generation,
      operationId: deps.operationId,
    });
  };
  const admit = () => {
    const valid =
      deps.isCurrent() &&
      entry.generation === deps.generation &&
      entry.policy.beforeAttempt().allowed;
    if (!valid) cancel();
    return valid;
  };
  return {
    admit,
    cancel,
    async prepare(snapshot: CartSnapshot) {
      if (entry.started) return false;
      entry.started = true;
      deps.dispatch({
        type: 'command/sending',
        generation: deps.generation,
        operationId: deps.operationId,
      });
      try {
        if (!(await entry.prepare(snapshot))) {
          cancel();
          return false;
        }
      } catch {
        cancel();
        return false;
      }
      return admit();
    },
    finish(result: SharedCartMutationResult) {
      if (!deps.isCurrent()) {
        entry.finish(result, false);
        return false;
      }
      entry.finish(result);
      if (!entry.canProject()) {
        cancel();
        return false;
      }
      if (!result.ok) {
        if (result.snapshot)
          deps.dispatch({
            type: 'snapshot/polled',
            generation: deps.generation,
            snapshot: result.snapshot,
          });
        cancel();
        return false;
      }
      return true;
    },
  };
}
