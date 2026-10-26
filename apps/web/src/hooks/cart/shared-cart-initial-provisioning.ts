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
    'generationRef' | 'dispatch' | 'setLinkPhase'
  > &
    Pick<ReturnType<typeof createCartProvisioning>, 'ensureCart'>,
  lifecycle: {
    isLive: () => boolean;
    whenVisible: (callback: () => void) => void;
    schedule: (callback: () => void, delay: number) => void;
  }
) {
  const generation = runtime.generationRef.current;
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
    if (!result)
      runtime.dispatch({
        generation,
        code: 'temporarily_unavailable',
        type: 'import/failed',
      });
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
