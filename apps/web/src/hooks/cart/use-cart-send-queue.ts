'use client';

import { useEffect } from 'react';
import { reportCartCookieStorageFailure } from './cart-cookie-storage-failure';
import { isCartCookieEpochCurrent } from './cart-cross-tab-lock';

import {
  saveCartToStorage,
  stripUnconfirmedDisplayLines,
} from './cart-storage';
import {
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  backoffMs,
  buildCommand,
  jittered,
  MAX_AUTO_RETRIES,
  RETRY_BASE_MS,
} from './shared-cart-hook-support';
import type { createCartProvisioning } from './shared-cart-provisioning';
import { isTerminalCart } from './shared-cart-queue';
import type { createCartSnapshotActions } from './shared-cart-snapshots';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function useCartSendQueue(
  context: SharedCartRuntime &
    Pick<ReturnType<typeof createCartSnapshotActions>, 'hydrateMissing'> &
    Pick<
      ReturnType<typeof createCartProvisioning>,
      'ensureCart' | 'finishImportOp'
    >
) {
  const {
    merchantSlug,
    sessionGeneration,
    enabled,
    state,
    dispatch,
    linkPhase,
    stateRef,
    generationRef,
    importOpIdsRef,
    optionsRef,
    hydrateMissing,
    ensureCart,
    finishImportOp,
  } = context;
  // One per-cart send queue: strict head-of-line order, one in flight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ensureCart and finishImportOp close over refs and stable dispatch only; the queue state drives re-runs.
  useEffect(() => {
    if (!enabled || linkPhase !== 'ready') return;
    const generation = sessionGeneration;
    // Settle import ops the reducer dropped without a sender-visible outcome
    // so the import never sticks at pending with edits gated behind it.
    if (importOpIdsRef.current.size > 0) {
      const queued = new Set(state.queue.map((entry) => entry.operationId));
      for (const operationId of [...importOpIdsRef.current]) {
        if (!queued.has(operationId)) {
          importOpIdsRef.current.delete(operationId);
        }
      }
      if (
        importOpIdsRef.current.size === 0 &&
        state.importStatus === 'pending'
      ) {
        dispatch({
          code: state.syncError ?? 'version_conflict',
          generation,
          type: 'import/failed',
        });
      }
    }
    const head = state.queue[0];
    if (head?.state !== 'queued' || head?.blockedOnTempId) return;
    const cookieEpoch = context.cookieEpochRef.current?.value;
    async function send(): Promise<void> {
      if (generationRef.current !== generation) return;
      if (
        reportCartCookieStorageFailure(dispatch, generation, head.operationId)
      )
        return;
      if (!isCartCookieEpochCurrent(context.cookieEpochRef.current?.value))
        return;
      const current = stateRef.current;
      const pending = current.queue.find(
        (entry) => entry.operationId === head.operationId
      );
      if (pending?.state !== 'queued') return;
      if (
        !current.cartId ||
        !current.confirmed ||
        isTerminalCart(current.confirmed)
      ) {
        const ensured = await ensureCart();
        if (generationRef.current !== generation || ensured === null) return;
        if (!ensured.ok) {
          // Surface the provisioning failure on the head entry for retry.
          dispatch({
            code: ensured.code,
            generation,
            operationId: pending.operationId,
            retryable: ensured.retryable,
            type: 'command/failed',
          });
          return;
        }
        // ensureCart adopted; the state update re-runs this effect.
        return;
      }
      const command = buildCommand(pending.intent, current);
      if (!command) {
        if (
          (pending.intent.kind === 'set_quantity' ||
            pending.intent.kind === 'remove') &&
          pending.intent.target.kind === 'identity' &&
          current.importStatus === 'pending'
        ) {
          // The import may still deliver this line; wait for it.
          return;
        }
        dispatch({
          code: 'not_found',
          generation,
          operationId: pending.operationId,
          retryable: false,
          type: 'command/failed',
        });
        finishImportOp(pending.operationId, { code: 'not_found', ok: false });
        return;
      }
      const adoptIfTerminal = async (): Promise<boolean> => {
        const fresh = await fetchSharedCartSnapshot(
          undefined,
          optionsRef.current.merchantSlug
        );
        if (generationRef.current !== generation) return true;
        if (!fresh.ok || !isTerminalCart(fresh.snapshot)) return false;
        dispatch({
          generation,
          snapshot: fresh.snapshot,
          type: 'snapshot/polled',
        });
        return true;
      };
      dispatch({
        generation,
        operationId: pending.operationId,
        type: 'command/sending',
      });
      // Checkout commits completion before cleanup runs. Refresh while holding
      // the queue head so a completed cart adopts without mutating, while later
      // user actions remain queued behind this clear barrier.
      if (pending.intent.kind === 'clear' && (await adoptIfTerminal())) return;
      if (!isCartCookieEpochCurrent(cookieEpoch)) return;
      const result = await sendSharedCartCommand(
        {
          command,
          expectedVersion:
            pending.intent.kind === 'replace'
              ? pending.intent.expectedVersion
              : current.confirmed.version,
          operationId: pending.operationId,
        },
        optionsRef.current.merchantSlug
      );
      if (generationRef.current !== generation) return;
      if (result.ok) {
        dispatch({
          generation,
          operationId: pending.operationId,
          snapshot: result.snapshot,
          type: 'command/reconciled',
        });
        finishImportOp(pending.operationId, { ok: true });
        void hydrateMissing(result.snapshot);
        return;
      }
      if (result.code === 'cart_locked' && (await adoptIfTerminal())) return;
      if (result.code === 'version_conflict') {
        if (pending.intent.kind === 'replace') {
          if (result.snapshot)
            dispatch({
              generation,
              snapshot: result.snapshot,
              type: 'snapshot/polled',
            });
          dispatch({
            generation,
            operationId: pending.operationId,
            code: 'refresh_required',
            retryable: false,
            type: 'command/failed',
          });
          finishImportOp(pending.operationId, {
            ok: false,
            code: 'refresh_required',
          });
          return;
        }
        if (result.snapshot) {
          dispatch({
            generation,
            operationId: pending.operationId,
            snapshot: result.snapshot,
            type: 'command/conflict',
          });
          return;
        }
        const fresh = await fetchSharedCartSnapshot(
          undefined,
          optionsRef.current.merchantSlug
        );
        if (generationRef.current !== generation) return;
        dispatch(
          fresh.ok
            ? {
                generation,
                operationId: pending.operationId,
                snapshot: fresh.snapshot,
                type: 'command/conflict',
              }
            : {
                code: fresh.code,
                generation,
                operationId: pending.operationId,
                retryable: fresh.retryable,
                type: 'command/failed',
              }
        );
        return;
      }
      dispatch({
        code: result.code,
        generation,
        operationId: pending.operationId,
        retryable: result.retryable,
        type: 'command/failed',
      });
      if (!result.retryable)
        finishImportOp(pending.operationId, { code: result.code, ok: false });
    }
    void send();
  }, [enabled, linkPhase, sessionGeneration, state]);

  // Retry loop: the first failed entry requeues after backoff, capped so
  // a poisoned queue parks for an explicit retry instead of hammering.
  useEffect(() => {
    if (!enabled) return;
    const generation = sessionGeneration;
    const failed = state.queue.find((entry) => entry.state === 'failed');
    if (!failed || failed.attempts >= MAX_AUTO_RETRIES) return;
    const timer = setTimeout(
      () => {
        if (generationRef.current !== generation) return;
        dispatch({
          generation,
          operationId: failed.operationId,
          type: 'command/retry',
        });
      },
      jittered(backoffMs(RETRY_BASE_MS, failed.attempts))
    );
    return () => clearTimeout(timer);
  }, [
    enabled,
    sessionGeneration,
    state.queue,
    generationRef.current,
    dispatch,
  ]);

  // The display cache mirrors confirmed state only once the legacy
  // import resolves: persisting earlier would overwrite the import
  // source before its receipt exists.
  useEffect(() => {
    // Skip the merchant-switch transition commit: the reducer state still
    // belongs to the previous session while the slug already names the
    // next one, so persisting here would file A's lines under B's key.
    if (
      !enabled ||
      state.generation !== sessionGeneration ||
      (state.importStatus !== 'done' && state.importStatus !== 'skipped')
    )
      return;
    saveCartToStorage(
      stripUnconfirmedDisplayLines(state.display),
      merchantSlug
    );
  }, [
    enabled,
    merchantSlug,
    sessionGeneration,
    state.display,
    state.generation,
    state.importStatus,
  ]);
  return {};
}
