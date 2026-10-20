'use client';

import { ADOPT_RETRY_BASE_MS, backoffMs } from './shared-cart-hook-support';
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
    if (!result || (!result.ok && result.retryable)) {
      lifecycle.schedule(
        () => void provision(attempt + 1),
        backoffMs(ADOPT_RETRY_BASE_MS, attempt)
      );
      return;
    }
    if (!result.ok)
      runtime.dispatch({
        generation,
        code: result.code,
        type: 'import/failed',
      });
    runtime.setLinkPhase('ready');
  }
  return provision;
}
