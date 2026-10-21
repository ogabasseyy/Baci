'use client';

import type { CartErrorCode, CartSnapshot } from '@baci/shared/cart';
import { reportCartCookieStorageFailure } from './cart-cookie-storage-failure';
import { isCartCookieEpochCurrent } from './cart-cross-tab-lock';
import { saveSharedCartImportReceipt } from './cart-storage';
import { bootstrapSharedCart, createSharedCart } from './shared-cart-client';
import type { EnsureCartResult } from './shared-cart-hook-support';
import { adoptPreservedFallback } from './shared-cart-preserved-fallback';
import { planProvisioningImport } from './shared-cart-provisioning-plan';
import { isTerminalCart } from './shared-cart-queue';
import { revokeCartDeviceSession } from './shared-cart-session-revoke-client';
import { getCartSessionGeneration } from './shared-cart-storage';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

export function createCartProvisioning(
  context: SharedCartRuntime & {
    hydrateMissing?: (snapshot: CartSnapshot) => Promise<void>;
  }
) {
  const {
    dispatch,
    stateRef,
    generationRef,
    enabledRef,
    linkRunRef,
    adoptOutcomeRef,
    importOpIdsRef,
    createOpRef,
    createRequestRef,
    createAttemptedRef,
    retiredCartIdRef,
    bootstrappingRef,
    optionsRef,
  } = context;

  async function ensureCart(
    canProceed: () => boolean = () => true
  ): Promise<EnsureCartResult> {
    if (reportCartCookieStorageFailure(dispatch, generationRef.current))
      return { ok: false, code: 'temporarily_unavailable', retryable: true };
    if (
      !isCartCookieEpochCurrent(
        context.cookieEpochRef.current?.value,
        context.merchantSlug
      )
    )
      return null;
    const cookieEpoch = context.cookieEpochRef.current?.value;
    const generation = generationRef.current;
    const linkRun = linkRunRef.current;
    const storageGeneration = getCartSessionGeneration(context.merchantSlug);
    const merchantSlug = optionsRef.current.merchantSlug;
    const fenced = () =>
      isCartCookieEpochCurrent(cookieEpoch, context.merchantSlug) &&
      getCartSessionGeneration(context.merchantSlug) === storageGeneration &&
      generationRef.current === generation &&
      linkRunRef.current === linkRun &&
      enabledRef.current;
    const live = () => fenced() && canProceed();
    const retireLateSession = () => {
      if (generationRef.current === generation && !enabledRef.current) {
        void revokeCartDeviceSession(merchantSlug, { fenceOnFailure: true });
      }
    };
    if (!live()) return null;
    const current = stateRef.current;
    // A snapshot read can observe a committed create before its lost reply
    // is reconciled. Replay that creation to finish the import and receipt.
    const pendingCreateImport =
      current.importStatus === 'pending' &&
      Boolean(createRequestRef.current?.lines);
    if (
      !pendingCreateImport &&
      current.cartId &&
      current.confirmed &&
      !isTerminalCart(current.confirmed)
    )
      return { ok: true };
    if (
      current.confirmed &&
      isTerminalCart(current.confirmed) &&
      retiredCartIdRef.current !== current.cartId
    ) {
      retiredCartIdRef.current = current.cartId;
      adoptOutcomeRef.current = 'none';
      createAttemptedRef.current = false;
      createOpRef.current = crypto.randomUUID();
      // Leave the request unset so the planning gate below can re-plan
      // device lines preserved across the terminal adoption.
      createRequestRef.current = null;
      importOpIdsRef.current = new Set();
    }
    // Defensive: the sender only runs once linked, so adoption has
    // settled by the time these paths are reachable.
    const unsettled = {
      code: 'temporarily_unavailable' as const,
      ok: false as const,
      retryable: true,
    };
    if (adoptOutcomeRef.current === 'unknown') return unsettled;
    if (
      adoptOutcomeRef.current === 'none' ||
      adoptOutcomeRef.current === 'expired'
    ) {
      if (bootstrappingRef.current) return null;
      bootstrappingRef.current = true;
      try {
        const bootstrapped = await bootstrapSharedCart(
          optionsRef.current.merchantSlug ?? undefined
        );
        if (!fenced()) {
          retireLateSession();
          return null;
        }
        if (!bootstrapped.ok) {
          return {
            code: bootstrapped.code,
            ok: false,
            retryable: bootstrapped.retryable,
          };
        }
        adoptOutcomeRef.current = 'bootstrap';
      } finally {
        if (
          linkRunRef.current === linkRun &&
          generationRef.current === generation
        )
          bootstrappingRef.current = false;
      }
    }
    if (!live() || createAttemptedRef.current) return null;
    const canAdoptPreserved =
      adoptOutcomeRef.current === 'bootstrap' && !createRequestRef.current;
    createAttemptedRef.current = true;
    if (!createRequestRef.current) {
      const status = stateRef.current.importStatus;
      const { planned } = planProvisioningImport(
        optionsRef.current.merchantSlug,
        stateRef.current
      );
      if (planned?.kind === 'blocked') {
        // Over-capacity first import: surface the same actionable
        // capacity outcome as the server-cart path instead of hiding
        // the cached lines behind an empty create. Release the
        // attempt latch so trimming the cache can re-plan.
        dispatch({ generation, type: 'import/capacity_exceeded' });
        createAttemptedRef.current = false;
        return { code: 'too_many_lines', ok: false, retryable: false };
      }
      const lines = planned?.kind === 'create' ? planned.lines : undefined;
      if (planned?.kind === 'create') {
        dispatch({
          generation,
          type: 'import/started',
          warnings: planned.warnings,
        });
      } else if (status === 'none') {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      }
      createOpRef.current =
        planned?.kind === 'create' ? planned.operationId : crypto.randomUUID();
      // An indeterminate create must retry the exact body even if local cache changes.
      createRequestRef.current = structuredClone({
        ...(lines ? { lines } : {}),
        operationId: createOpRef.current,
      });
    }
    const request = createRequestRef.current;
    const lines = request.lines;
    const created = await createSharedCart(
      request,
      optionsRef.current.merchantSlug
    );
    if (!fenced()) {
      retireLateSession();
      return null;
    }
    if (!created.ok) {
      // Every failure releases the attempt latch: the stable createOpRef
      // key makes the retry replay-safe, so a new attempt must be
      // allowed instead of stranding the head entry behind a set latch.
      createAttemptedRef.current = false;
      // A definitive bootstrap-scope rejection can mean another tab installed
      // a live session. Never substitute a GET for an indeterminate replay.
      if (canAdoptPreserved && created.code === 'unauthorized') {
        const adopted = await adoptPreservedFallback(
          context,
          merchantSlug,
          fenced,
          () => ensureCart(canProceed)
        );
        if (adopted) return adopted;
        if (!fenced()) return null;
      }
      if (lines) {
        if (created.retryable) {
          // Keep the import pending; the failed head entry drives the
          // retry loop, which re-runs ensureCart with the same derived
          // operation key.
          return {
            code: created.code,
            ok: false,
            retryable: true,
          };
        }
        dispatch({
          code: created.code,
          generation,
          type: 'import/failed',
        });
        importOpIdsRef.current = new Set();
        // Fall through to an empty cart so user actions can still
        // proceed; the legacy cache stays in storage for retryImport.
        // The empty create needs a fresh key: reusing the import-derived
        // key with a different body would be an idempotency conflict.
        createOpRef.current = crypto.randomUUID();
        createRequestRef.current = { operationId: createOpRef.current };
        return ensureCart(canProceed);
      }
      return { code: created.code, ok: false, retryable: created.retryable };
    }
    dispatch({ generation, snapshot: created.snapshot, type: 'link/snapshot' });
    if (lines) {
      dispatch({
        generation,
        lineCount: lines?.length ?? 0,
        snapshot: created.snapshot,
        type: 'import/finished',
      });
      importOpIdsRef.current = new Set();
      saveSharedCartImportReceipt(optionsRef.current.merchantSlug, {
        cartId: created.snapshot.cartId,
        importedAt: new Date().toISOString(),
        lineCount: lines?.length ?? 0,
      });
    }
    return { ok: true };
  }

  function finishImportOp(
    operationId: string,
    outcome: { ok: true } | { ok: false; code: CartErrorCode }
  ): void {
    const generation = generationRef.current;
    if (!importOpIdsRef.current.has(operationId)) return;
    importOpIdsRef.current.delete(operationId);
    if (!outcome.ok) {
      importOpIdsRef.current = new Set();
      dispatch({
        code: outcome.code,
        generation,
        type: 'import/failed',
      });
      return;
    }
    if (importOpIdsRef.current.size > 0) return;
    const current = stateRef.current;
    if (!current.confirmed) return;
    dispatch({
      generation,
      lineCount: current.confirmed.lines.length,
      snapshot: current.confirmed,
      type: 'import/finished',
    });
    saveSharedCartImportReceipt(optionsRef.current.merchantSlug, {
      cartId: current.confirmed.cartId,
      importedAt: new Date().toISOString(),
      lineCount: current.confirmed.lines.length,
    });
  }
  return { ensureCart, finishImportOp };
}
