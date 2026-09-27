import { withCheckoutStorageTimeout } from '@/lib/with-checkout-storage-timeout';

let restorePromise: Promise<unknown> | undefined;
let restoredGeneration: string | undefined;

function noteRestoreStarted(promise: Promise<unknown>): void {
  restorePromise = promise;
  const tracked = promise;
  const clearTracked = () => {
    if (restorePromise === tracked) {
      restorePromise = undefined;
    }
  };
  void tracked.then(clearTracked, clearTracked);
}

function noteRestoredGeneration(checkoutGeneration: string): void {
  restoredGeneration = checkoutGeneration;
}

function lastRestoredGeneration(): string | undefined {
  return restoredGeneration;
}

async function waitForRestore(): Promise<void> {
  const pending = restorePromise;
  if (!pending) {
    return;
  }
  // Bounded so a hung restore fails the submit instead of blocking
  // checkout forever; the timeout message distinguishes this gate.
  await withCheckoutStorageTimeout(
    pending.then(() => undefined),
    undefined,
    'Checkout generation restore timed out'
  );
}

export const checkoutGenerationRestoreGate = {
  lastRestoredGeneration,
  noteRestoredGeneration,
  noteRestoreStarted,
  waitForRestore,
};
