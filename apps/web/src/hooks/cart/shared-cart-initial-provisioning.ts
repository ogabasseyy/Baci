'use client';

import {
  ADOPT_RETRY_BASE_MS,
  backoffMs,
  MAX_AUTO_RETRIES,
} from './shared-cart-hook-support';
import type { createCartProvisioning } from './shared-cart-provisioning';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

/** Reconcile initial creation without substituting a GET for its import receipt. */
export function createInitialCartProvisioner(
  runtime: Pick<
    SharedCartRuntime,
    | 'generationRef'
    | 'dispatch'
    | 'setLinkPhase'
    | 'bootstrappingRef'
    | 'createRequestRef'
  > &
    Pick<ReturnType<typeof createCartProvisioning>, 'ensureCart'>,
  lifecycle: {
    isLive: () => boolean;
    whenVisible: (callback: () => void) => void;
    schedule: (callback: () => void, delay: number) => void;
  }
) {
  const generation = runtime.generationRef.current;
  // The owner-wait below reschedules with a fresh attempt budget, so
  // bound the total owner waits separately: a stale owner ref must
  // not strand the import pending forever.
  let ownerWaits = 0;
  const live = () =>
    lifecycle.isLive() && runtime.generationRef.current === generation;
  async function provision(attempt: number): Promise<void> {
    if (!live()) return;
    if (document.hidden) {
      lifecycle.whenVisible(() => void provision(attempt));
      return;
    }
    const result = await runtime.ensureCart(() => live() && !document.hidden);
    if (!live()) return;
    if (
      (!result || (!result.ok && result.retryable)) &&
      attempt < MAX_AUTO_RETRIES
    ) {
      lifecycle.schedule(
        () => void provision(attempt + 1),
        backoffMs(ADOPT_RETRY_BASE_MS, attempt)
      );
      return;
    }
    // A null result means a parallel bootstrap/create owns provisioning
    // (or the session moved on): that owner resolves the import, so a
    // slow-but-healthy in-flight attempt must not flip to failed. Once
    // retries are exhausted, though, a null with no owner in this tab
    // must not strand the import pending behind the checkout gate.
    if (!result) {
      // A parallel bootstrap/create still in flight owns the import:
      // keep waiting for it instead of failing its import or forcing
      // the link ready underneath it.
      const ownerInFlight =
        runtime.bootstrappingRef?.current || runtime.createRequestRef?.current;
      if (ownerInFlight && ownerWaits < MAX_AUTO_RETRIES) {
        ownerWaits += 1;
        lifecycle.schedule(
          () => void provision(0),
          backoffMs(ADOPT_RETRY_BASE_MS, attempt)
        );
        return;
      }
      runtime.dispatch({
        generation,
        code: 'temporarily_unavailable',
        type: 'import/failed',
      });
    }
    if (result && !result.ok)
      runtime.dispatch({
        generation,
        code: result.code,
        type: 'import/failed',
      });
    runtime.setLinkPhase('ready');
  }
  return provision;
}
