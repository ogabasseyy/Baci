'use client';

import {
  type CartCommand,
  type CartErrorCode,
  type CartSnapshot,
  cartLineIdentity,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { CartMergeConflict } from '@/lib/cart/merge';
import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import type { Product } from '@/lib/products';
import {
  getCartFromStorage,
  getSharedCartImportReceipt,
  saveCartToStorage,
  saveSharedCartImportReceipt,
  stripUnconfirmedDisplayLines,
} from './cart-storage';
import type {
  AddToCartOptions,
  CartItem,
  SharedCartDisplayItem,
  SharedCartImportStatus,
  SharedCartSyncStatus,
} from './cart-types';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import {
  cartItemToIdentity,
  deriveSyncStatus,
  initialSharedCartState,
  planLegacyImport,
  type SharedCartIntent,
  type SharedCartLineTarget,
  type SharedCartState,
  sharedCartReducer,
} from './shared-cart-reducer';

export interface UseSharedCartOptions {
  merchantId: string;
  merchantSlug: string | null;
  sessionGeneration: number;
  enabled?: boolean;
  /** Task 8 wires the live subscription; until then the fallback poll owns convergence. */
  realtimeConnected?: boolean;
  /** The owning surface gates background polling when it goes inactive. */
  surfaceActive?: boolean;
}

export interface UseSharedCartResult {
  cart: SharedCartDisplayItem[];
  cartId: string | null;
  version: number | null;
  cartCount: number;
  cartTotal: number;
  isHydrated: boolean;
  syncStatus: SharedCartSyncStatus;
  syncError: CartErrorCode | null;
  importStatus: SharedCartImportStatus;
  importConflicts: CartMergeConflict[];
  importWarnings: string[];
  addToCart: (
    product: Product,
    quantity?: number,
    options?: AddToCartOptions
  ) => void;
  removeFromCart: (cartItemIdOrProductId: string, variantId?: string) => void;
  updateQuantity: (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => void;
  clearCart: () => void;
  repriceLine: (line: SharedCartDisplayItem, price?: number) => void;
  toggleAssurance: (cartItemId: string) => void;
  retryPendingSync: () => void;
  retryImport: () => void;
}

type AdoptOutcome = 'unknown' | 'session' | 'bootstrap' | 'none' | 'expired';

/**
 * Failure detail for cart provisioning. `null` means the session
 * generation moved on mid-flight and the caller must stay silent; every
 * other failure carries its real code so the head entry surfaces it
 * instead of stalling silently in the queue.
 */
type EnsureCartResult =
  | { ok: true }
  | { ok: false; code: CartErrorCode; retryable: boolean }
  | null;

const FALLBACK_POLL_MS = 15_000;
const RECONCILE_POLL_MS = 60_000;
const FETCH_COALESCE_MS = 5_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const MAX_AUTO_RETRIES = 5;
const ADOPT_RETRY_BASE_MS = 1_000;

/** Shared inert action for the disabled hook shape. */
function noop(): void {
  // Intentionally empty: the disabled hook never acts.
}

function jittered(baseMs: number): number {
  return baseMs * (0.8 + Math.random() * 0.4);
}

function backoffMs(baseMs: number, attempts: number): number {
  return Math.min(RETRY_MAX_MS, baseMs * 2 ** attempts);
}

function findMatchingLineIndex(
  display: SharedCartDisplayItem[],
  cartItemIdOrProductId: string,
  variantId?: string
): number {
  const exact = display.findIndex(
    (line) => line.cartItemId === cartItemIdOrProductId
  );
  if (exact >= 0) return exact;
  return display.findIndex((line) => {
    if (line.id !== cartItemIdOrProductId) return false;
    if (variantId !== undefined) return line.variantId === variantId;
    return line.variantId === undefined;
  });
}

function targetForLine(line: SharedCartDisplayItem): SharedCartLineTarget {
  // A stable server id always wins: temp targets resolve only when an add
  // reconciles, so preferring a stale temp claim would strand edits behind
  // an unresolvable block. Pure optimistic lines have no server id yet.
  if (line.serverLineId) return { kind: 'lineId', lineId: line.serverLineId };
  if (line.pendingTempId) return { kind: 'temp', tempId: line.pendingTempId };
  return { kind: 'identity', key: cartLineIdentity(cartItemToIdentity(line)) };
}

function seedProducts(cached: CartItem[]): Record<string, Product> {
  const products: Record<string, Product> = {};
  for (const item of cached) {
    products[cartLineIdentity(cartItemToIdentity(item))] = item as Product;
  }
  return products;
}

function optionsFromLine(line: SharedCartDisplayItem): AddToCartOptions {
  return {
    color: line.selectedColor,
    colorValue: line.selectedColorValue,
    condition: line.condition,
    quizAwardId: line.quizAwardId ?? undefined,
    quizVoucherToken: line.quizVoucherToken ?? undefined,
    secondaryColor: line.secondaryColor,
    secondaryColorValue: line.secondaryColorValue,
    storage: line.selectedStorage,
    variantAttributes: line.variantAttributes,
    variantId: line.variantId,
  };
}

function resolveCommandTarget(
  target: SharedCartLineTarget,
  confirmed: CartSnapshot | null
): string | null {
  if (!confirmed) return null;
  if (target.kind === 'lineId') {
    return confirmed.lines.some((line) => line.id === target.lineId)
      ? target.lineId
      : null;
  }
  if (target.kind === 'identity') {
    return (
      confirmed.lines.find((line) => cartLineIdentity(line.item) === target.key)
        ?.id ?? null
    );
  }
  return null;
}

function buildCommand(
  intent: SharedCartIntent,
  state: SharedCartState
): CartCommand | null {
  if (intent.kind === 'clear') return { type: 'clear' };
  if (intent.kind === 'add') {
    if (intent.input) {
      return {
        ...(intent.input.negotiatedUnitPriceMinor != null
          ? {
              negotiatedUnitPriceMinor: intent.input.negotiatedUnitPriceMinor,
            }
          : {}),
        ...(intent.input.negotiationStatus
          ? { negotiationStatus: intent.input.negotiationStatus }
          : {}),
        ...(intent.input.voucherToken
          ? { voucherToken: intent.input.voucherToken }
          : {}),
        ...(intent.input.voucherAwardId
          ? { voucherAwardId: intent.input.voucherAwardId }
          : {}),
        item: intent.input.item,
        quantity: intent.quantity,
        type: 'add',
      };
    }
    const item = cartItemToIdentity({
      condition: intent.options?.condition,
      id: intent.product.id,
      selectedColor: intent.options?.color,
      selectedColorValue: intent.options?.colorValue,
      selectedStorage: intent.options?.storage,
      secondaryColor: intent.options?.secondaryColor,
      secondaryColorValue: intent.options?.secondaryColorValue,
      variantAttributes: intent.options?.variantAttributes,
      variantId: intent.options?.variantId,
    });
    return {
      ...(intent.attachments?.negotiatedUnitPriceMinor != null
        ? {
            negotiatedUnitPriceMinor:
              intent.attachments.negotiatedUnitPriceMinor,
          }
        : {}),
      ...(intent.attachments?.negotiationStatus
        ? { negotiationStatus: intent.attachments.negotiationStatus }
        : {}),
      ...((intent.attachments?.voucherToken ?? intent.options?.quizVoucherToken)
        ? {
            voucherToken: (intent.attachments?.voucherToken ??
              intent.options?.quizVoucherToken) as string,
          }
        : {}),
      ...((intent.attachments?.voucherAwardId ?? intent.options?.quizAwardId)
        ? {
            voucherAwardId: (intent.attachments?.voucherAwardId ??
              intent.options?.quizAwardId) as string,
          }
        : {}),
      item,
      quantity: intent.quantity,
      type: 'add',
    };
  }
  const lineId = resolveCommandTarget(intent.target, state.confirmed);
  if (!lineId) return null;
  if (intent.kind === 'remove') return { lineId, type: 'remove' };
  return { lineId, quantity: intent.quantity, type: 'set_quantity' };
}

export function useSharedCart(
  options: UseSharedCartOptions
): UseSharedCartResult {
  const {
    merchantId,
    merchantSlug,
    sessionGeneration,
    enabled = true,
    realtimeConnected = false,
    surfaceActive = true,
  } = options;
  const [state, dispatch] = useReducer(
    sharedCartReducer,
    initialSharedCartState
  );
  const [hydrated, setHydrated] = useState(false);
  const [linkPhase, setLinkPhase] = useState<'adopting' | 'ready'>('adopting');
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(sessionGeneration);
  generationRef.current = sessionGeneration;
  const adoptOutcomeRef = useRef<AdoptOutcome>('unknown');
  const importOpIdsRef = useRef<Set<string>>(new Set());
  const createOpRef = useRef<string | null>(null);
  const createAttemptedRef = useRef(false);
  const bootstrappingRef = useRef(false);
  const lastFetchRef = useRef(0);
  const hydratingRef = useRef(false);
  const pendingHydrationRef = useRef<Set<string>>(new Set());
  const latestSnapshotRef = useRef<CartSnapshot | null>(null);
  // Invalidates in-flight hydration when the link restarts (merchant,
  // slug, or generation change) or unmounts.
  const linkRunRef = useRef(0);
  const tempCounterRef = useRef(0);
  const optionsRef = useRef({ merchantId, merchantSlug });
  optionsRef.current = { merchantId, merchantSlug };

  // Link lifecycle: seed from the display cache, then adopt. Every async
  // step checks its generation so a merchant switch or logout fences
  // late completions even before the reducer sees them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrateMissing closes over refs and stable dispatch only; listing it would relink every render.
  useEffect(() => {
    linkRunRef.current += 1;
    if (!enabled) {
      setHydrated(true);
      setLinkPhase('ready');
      return;
    }
    const generation = sessionGeneration;
    let cancelled = false;
    let adoptTimer: ReturnType<typeof setTimeout> | null = null;
    let removeVisibilityWaiter: (() => void) | null = null;
    adoptOutcomeRef.current = 'unknown';
    importOpIdsRef.current = new Set();
    createOpRef.current = null;
    createAttemptedRef.current = false;
    bootstrappingRef.current = false;
    // A restarted link owns its hydration loop: the previous run's loop
    // exits on the run check, and clearing both fields lets this run
    // start its own instead of stranding ids behind a stale flag.
    hydratingRef.current = false;
    pendingHydrationRef.current = new Set();
    latestSnapshotRef.current = null;
    setLinkPhase('adopting');

    const cached = getCartFromStorage(merchantSlug);
    dispatch({
      cached,
      generation,
      merchantId,
      products: seedProducts(cached),
      type: 'link/start',
    });
    setHydrated(true);

    async function adopt(attempt: number): Promise<void> {
      if (cancelled || generationRef.current !== generation) return;
      if (document.hidden) {
        // A background tab or prerender must not link yet — but it must
        // not strand the link either. Wait for the first foreground
        // presentation, then adopt with the same attempt number.
        removeVisibilityWaiter?.();
        const onVisible = () => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', onVisible);
          removeVisibilityWaiter = null;
          void adopt(attempt);
        };
        removeVisibilityWaiter = () =>
          document.removeEventListener('visibilitychange', onVisible);
        document.addEventListener('visibilitychange', onVisible);
        return;
      }
      const result = await fetchSharedCartSnapshot();
      if (cancelled || generationRef.current !== generation) return;
      if (result.ok) {
        adoptOutcomeRef.current = 'session';
        lastFetchRef.current = Date.now();
        dispatch({
          generation,
          snapshot: result.snapshot,
          type: 'link/snapshot',
        });
        setLinkPhase('ready');
        void hydrateMissing(result.snapshot);
        void maybeImport(result.snapshot, cached);
        return;
      }
      if (result.retryable) {
        adoptTimer = setTimeout(
          () => void adopt(attempt + 1),
          backoffMs(ADOPT_RETRY_BASE_MS, attempt)
        );
        return;
      }
      adoptOutcomeRef.current =
        result.code === 'not_found' ? 'bootstrap' : 'none';
      if (cached.length === 0) {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      }
      setLinkPhase('ready');
    }

    function maybeImport(snapshot: CartSnapshot, cached: CartItem[]): void {
      if (cancelled || generationRef.current !== generation) return;
      if (stateRef.current.importStatus !== 'none') return;
      const receipt = getSharedCartImportReceipt(merchantSlug);
      if (receipt?.cartId === snapshot.cartId) {
        dispatch({ generation, status: 'done', type: 'import/resolved' });
        return;
      }
      if (cached.length === 0) {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
        return;
      }
      const planned = planLegacyImport(cached, snapshot, snapshot.cartId);
      if (planned.kind === 'nothing') {
        dispatch({ generation, status: 'skipped', type: 'import/resolved' });
        return;
      }
      if (planned.kind === 'conflicts') {
        dispatch({
          conflicts: planned.conflicts,
          generation,
          type: 'import/conflicts',
        });
        return;
      }
      if (planned.kind === 'create') {
        // No server cart exists yet: the first sender pass creates with
        // these lines instead of queueing per-line adds.
        dispatch({
          generation,
          type: 'import/started',
          warnings: planned.warnings,
        });
        importOpIdsRef.current = new Set([planned.operationId]);
        return;
      }
      dispatch({
        generation,
        type: 'import/started',
        warnings: planned.warnings,
      });
      const entries = [
        ...planned.adds.map((add) => ({
          intent: {
            input: add.line,
            kind: 'add' as const,
            product: {} as Product,
            quantity: add.line.quantity,
            tempId: `imp-${add.operationId.slice(-8)}`,
          },
          operationId: add.operationId,
        })),
        ...planned.sets.map((set, index) => ({
          intent: {
            kind: 'set_quantity' as const,
            quantity: set.quantity,
            target: { kind: 'lineId' as const, lineId: set.lineId },
          },
          operationId: `import:${snapshot.cartId}:set:${set.lineId}:${index}`,
        })),
      ];
      importOpIdsRef.current = new Set(
        entries.map((entry) => entry.operationId)
      );
      dispatch({ entries, generation, type: 'import/enqueue' });
    }

    void adopt(0);
    return () => {
      cancelled = true;
      if (adoptTimer) clearTimeout(adoptTimer);
      removeVisibilityWaiter?.();
      linkRunRef.current += 1;
    };
  }, [enabled, merchantId, merchantSlug, sessionGeneration]);

  // Hydrates product shells for lines the cache never saw. Every
  // snapshot path calls this (adopt, poll, foreground refresh,
  // reconcile) so lines another device adds never stick on the
  // fallback shell. Concurrent calls merge into one loop; ids filter
  // against the latest snapshot seen rather than the one that started
  // the loop (a newer snapshot's ids must survive a slow fetch) or the
  // reducer's confirmed lines (null before adoption lands and stale in
  // the dispatch lag window). Product shells keyed for lines that left
  // the cart are inert: display derives from confirmed lines only.
  async function hydrateMissing(snapshot: CartSnapshot): Promise<void> {
    const generation = generationRef.current;
    const linkRun = linkRunRef.current;
    const live = (): boolean =>
      linkRunRef.current === linkRun && generationRef.current === generation;
    latestSnapshotRef.current = snapshot;
    for (const line of snapshot.lines) {
      pendingHydrationRef.current.add(line.item.productId);
    }
    if (hydratingRef.current) return;
    hydratingRef.current = true;
    try {
      while (pendingHydrationRef.current.size > 0) {
        if (!live()) return;
        const universe = latestSnapshotRef.current?.lines ?? [];
        const known = stateRef.current.products;
        const ids = [...pendingHydrationRef.current].filter((id) =>
          universe.some(
            (line) =>
              line.item.productId === id &&
              known[cartLineIdentity(line.item)] === undefined
          )
        );
        pendingHydrationRef.current.clear();
        if (ids.length === 0) return;
        const products = await fetchSharedCartProducts(
          ids,
          optionsRef.current.merchantId
        );
        if (!live()) return;
        const keyed: Record<string, Product> = {};
        for (const line of latestSnapshotRef.current?.lines ?? []) {
          const product = products.get(line.item.productId);
          if (product) keyed[cartLineIdentity(line.item)] = product;
        }
        if (Object.keys(keyed).length > 0) {
          dispatch({
            generation,
            products: keyed,
            type: 'products/hydrated',
          });
        }
      }
    } finally {
      hydratingRef.current = false;
    }
  }

  async function refreshNow(): Promise<void> {
    const generation = generationRef.current;
    if (!enabled || document.hidden) return;
    // Adoption owns the first fetch: a foreground refresh racing a
    // deferred adopt would double-fetch and dispatch a bare poll
    // snapshot before the link (import, hydration, send-ready) runs.
    if (adoptOutcomeRef.current === 'unknown') return;
    if (Date.now() - lastFetchRef.current < FETCH_COALESCE_MS) return;
    const result = await fetchSharedCartSnapshot();
    if (generationRef.current !== generation) return;
    if (!result.ok) return;
    lastFetchRef.current = Date.now();
    dispatch({
      generation,
      snapshot: result.snapshot,
      type: 'snapshot/polled',
    });
    void hydrateMissing(result.snapshot);
  }

  // Convergence polling: fast fallback while realtime is unavailable,
  // slow reconciliation once Task 8 connects. Stops when hidden,
  // inactive, disabled, or unlinked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrateMissing closes over refs and stable dispatch only; listing it would restart polling every render.
  useEffect(() => {
    if (!enabled || !state.cartId || surfaceActive === false) return;
    const generation = sessionGeneration;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const baseMs = realtimeConnected ? RECONCILE_POLL_MS : FALLBACK_POLL_MS;
    const schedule = () => {
      timer = setTimeout(() => void tick(), jittered(baseMs));
    };
    const tick = async () => {
      if (stopped || generationRef.current !== generation) return;
      if (!document.hidden) {
        const result = await fetchSharedCartSnapshot();
        if (!stopped && generationRef.current === generation && result.ok) {
          lastFetchRef.current = Date.now();
          dispatch({
            generation,
            snapshot: result.snapshot,
            type: 'snapshot/polled',
          });
          void hydrateMissing(result.snapshot);
        }
      }
      schedule();
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    enabled,
    realtimeConnected,
    sessionGeneration,
    state.cartId,
    surfaceActive,
  ]);

  // Foreground and focus refetch, coalesced with recent reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNow is ref-stable and reads the live generation; re-subscribing per generation is unnecessary.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (!document.hidden) void refreshNow();
    };
    const onFocus = () => void refreshNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled]);

  async function ensureCart(): Promise<EnsureCartResult> {
    const generation = generationRef.current;
    const current = stateRef.current;
    if (current.cartId && current.confirmed) return { ok: true };
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
      if (bootstrappingRef.current) return unsettled;
      bootstrappingRef.current = true;
      try {
        const bootstrapped = await bootstrapSharedCart(
          optionsRef.current.merchantSlug ?? undefined
        );
        if (generationRef.current !== generation) return null;
        if (!bootstrapped.ok) {
          return {
            code: bootstrapped.code,
            ok: false,
            retryable: bootstrapped.retryable,
          };
        }
        adoptOutcomeRef.current = 'bootstrap';
      } finally {
        bootstrappingRef.current = false;
      }
    }
    if (createAttemptedRef.current) return unsettled;
    createAttemptedRef.current = true;
    const cached = getCartFromStorage(optionsRef.current.merchantSlug);
    const status = stateRef.current.importStatus;
    const planned =
      status === 'none' && cached.length > 0
        ? planLegacyImport(cached, null, null)
        : null;
    const lines = planned?.kind === 'create' ? planned.lines : undefined;
    if (planned?.kind === 'create') {
      dispatch({
        generation,
        type: 'import/started',
        warnings: planned.warnings,
      });
      importOpIdsRef.current = new Set([planned.operationId]);
    } else if (status === 'none') {
      dispatch({ generation, status: 'skipped', type: 'import/resolved' });
    }
    if (!createOpRef.current) {
      createOpRef.current =
        planned?.kind === 'create' ? planned.operationId : crypto.randomUUID();
    }
    const created = await createSharedCart({
      ...(lines ? { lines } : {}),
      operationId: createOpRef.current,
    });
    if (generationRef.current !== generation) return null;
    if (!created.ok) {
      // Every failure releases the attempt latch: the stable createOpRef
      // key makes the retry replay-safe, so a new attempt must be
      // allowed instead of stranding the head entry behind a set latch.
      createAttemptedRef.current = false;
      if (planned?.kind === 'create') {
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
        return ensureCart();
      }
      return { code: created.code, ok: false, retryable: created.retryable };
    }
    dispatch({ generation, snapshot: created.snapshot, type: 'link/snapshot' });
    if (planned?.kind === 'create') {
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

  // One per-cart send queue: strict head-of-line order, one in flight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ensureCart and finishImportOp close over refs and stable dispatch only; the queue state drives re-runs.
  useEffect(() => {
    if (!enabled || linkPhase !== 'ready') return;
    const generation = sessionGeneration;
    // Settle import ops the reducer dropped without a sender-visible
    // outcome (conflict-cap drops, dependent cascades, fatal refetch
    // failures): anything still tracked but no longer queued settles
    // here, so the import never sticks at pending with the persist
    // effect and identity-targeted edits gated behind it.
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

    async function send(): Promise<void> {
      if (generationRef.current !== generation) return;
      const current = stateRef.current;
      const pending = current.queue.find(
        (entry) => entry.operationId === head.operationId
      );
      if (pending?.state !== 'queued') return;
      if (!current.cartId || !current.confirmed) {
        const ensured = await ensureCart();
        if (generationRef.current !== generation || ensured === null) return;
        if (!ensured.ok) {
          // Surface the provisioning failure on the head entry: the
          // retry loop and retryPendingSync own recovery from here.
          // Silently returning would strand the entry in queued state
          // with no timer and no state change to re-run this effect.
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
      dispatch({
        generation,
        operationId: pending.operationId,
        type: 'command/sending',
      });
      const result = await sendSharedCartCommand({
        command,
        expectedVersion: current.confirmed.version,
        operationId: pending.operationId,
      });
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
      if (result.code === 'version_conflict') {
        if (result.snapshot) {
          dispatch({
            generation,
            operationId: pending.operationId,
            snapshot: result.snapshot,
            type: 'command/conflict',
          });
          return;
        }
        const fresh = await fetchSharedCartSnapshot();
        if (generationRef.current !== generation) return;
        if (fresh.ok) {
          dispatch({
            generation,
            operationId: pending.operationId,
            snapshot: fresh.snapshot,
            type: 'command/conflict',
          });
        } else {
          dispatch({
            code: fresh.code,
            generation,
            operationId: pending.operationId,
            retryable: fresh.retryable,
            type: 'command/failed',
          });
        }
        return;
      }
      dispatch({
        code: result.code,
        generation,
        operationId: pending.operationId,
        retryable: result.retryable,
        type: 'command/failed',
      });
      if (!result.retryable) {
        finishImportOp(pending.operationId, { code: result.code, ok: false });
      }
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
  }, [enabled, sessionGeneration, state.queue]);

  // The display cache mirrors confirmed state only once the legacy
  // import resolves: persisting earlier would overwrite the import
  // source before its receipt exists.
  useEffect(() => {
    if (!enabled) return;
    // Skip the merchant-switch transition commit: the reducer state still
    // belongs to the previous session while the slug already names the
    // next one, so persisting here would file A's lines under B's key.
    if (state.generation !== sessionGeneration) return;
    if (state.importStatus !== 'done' && state.importStatus !== 'skipped') {
      return;
    }
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

  function enqueueIntent(intent: SharedCartIntent): void {
    if (!enabled) return;
    const generation = generationRef.current;
    dispatch({
      entry: { intent, operationId: crypto.randomUUID() },
      generation,
      type: 'command/enqueue',
    });
  }

  function addToCart(
    product: Product,
    quantity = 1,
    options?: AddToCartOptions
  ): void {
    if (!enabled) return;
    // Mirror gateAddToCart exactly: an award id alone (no token yet)
    // exempts the reserved unit from the stock guard and pins quantity.
    const isVoucherProduct = Boolean(
      options?.quizVoucherToken ||
        options?.quizAwardId ||
        (product as unknown as Record<string, unknown>).quizVoucherToken ||
        (product as unknown as Record<string, unknown>).isQuizPrize
    );
    if (product.manage_stock && product.stock <= 0 && !isVoucherProduct) {
      return;
    }
    if (options?.variantRequired && !options?.variantId) return;
    const current = stateRef.current;
    const key = cartLineIdentity(
      cartItemToIdentity({
        condition: options?.condition,
        id: product.id,
        selectedColor: options?.color,
        selectedColorValue: options?.colorValue,
        selectedStorage: options?.storage,
        secondaryColor: options?.secondaryColor,
        secondaryColorValue: options?.secondaryColorValue,
        variantAttributes: options?.variantAttributes,
        variantId: options?.variantId,
      })
    );
    const existing = current.display
      .filter((line) => cartLineIdentity(cartItemToIdentity(line)) === key)
      .reduce((sum, line) => sum + line.quantity, 0);
    let sendQuantity = Math.max(1, Math.floor(quantity));
    if (isVoucherProduct) sendQuantity = 1;
    sendQuantity = Math.min(
      sendQuantity,
      SHARED_CART_MAX_QUANTITY_PER_LINE - existing
    );
    if (sendQuantity <= 0) return;
    tempCounterRef.current += 1;
    const tempId = `t${tempCounterRef.current}-${Date.now().toString(36)}`;
    dispatch({
      generation: generationRef.current,
      products: { [key]: product },
      type: 'products/hydrated',
    });
    enqueueIntent({
      kind: 'add',
      options,
      product,
      quantity: sendQuantity,
      tempId,
    });
  }

  function removeFromCart(
    cartItemIdOrProductId: string,
    variantId?: string
  ): void {
    if (!enabled) return;
    const current = stateRef.current;
    const index = findMatchingLineIndex(
      current.display,
      cartItemIdOrProductId,
      variantId
    );
    if (index === -1) return;
    const line = current.display[index];
    if (!line) return;
    enqueueIntent({ kind: 'remove', target: targetForLine(line) });
  }

  function updateQuantity(
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ): void {
    if (!enabled) return;
    if (quantity <= 0) {
      removeFromCart(cartItemIdOrProductId, variantId);
      return;
    }
    const current = stateRef.current;
    const index = findMatchingLineIndex(
      current.display,
      cartItemIdOrProductId,
      variantId
    );
    if (index === -1) return;
    const line = current.display[index];
    if (!line) return;
    const minimum = line.minimum_order_quantity ?? 1;
    const clamped = Math.min(
      SHARED_CART_MAX_QUANTITY_PER_LINE,
      Math.max(minimum, Math.floor(quantity))
    );
    enqueueIntent({
      kind: 'set_quantity',
      quantity: clamped,
      target: targetForLine(line),
    });
  }

  function clearCart(): void {
    enqueueIntent({ kind: 'clear' });
  }

  function repriceLine(line: SharedCartDisplayItem, price?: number): void {
    if (!enabled) return;
    const generation = generationRef.current;
    const key = cartLineIdentity(cartItemToIdentity(line));
    const target = targetForLine(line);
    const options = optionsFromLine(line);
    tempCounterRef.current += 1;
    const tempId = `t${tempCounterRef.current}-${Date.now().toString(36)}`;
    const attachments =
      price == null
        ? undefined
        : {
            negotiatedUnitPriceMinor: Math.round(price * 100),
            negotiationStatus: 'accepted' as const,
          };
    dispatch({
      generation,
      products: { [key]: line as unknown as Product },
      type: 'products/hydrated',
    });
    dispatch({
      generation,
      hasAssurance: line.hasAssurance ?? false,
      lineKey: key,
      type: 'assurance/overlay',
    });
    dispatch({
      entry: {
        intent: { kind: 'remove', target },
        operationId: crypto.randomUUID(),
      },
      generation,
      type: 'command/enqueue',
    });
    dispatch({
      entry: {
        intent: {
          attachments,
          kind: 'add',
          options,
          product: line as unknown as Product,
          quantity: Math.min(line.quantity, SHARED_CART_MAX_QUANTITY_PER_LINE),
          tempId,
        },
        operationId: crypto.randomUUID(),
      },
      generation,
      type: 'command/enqueue',
    });
  }

  function toggleAssurance(cartItemId: string): void {
    if (!enabled) return;
    const current = stateRef.current;
    const line = current.display.find((item) => item.cartItemId === cartItemId);
    if (!line) return;
    dispatch({
      generation: generationRef.current,
      hasAssurance: !(line.hasAssurance ?? false),
      lineKey: cartLineIdentity(cartItemToIdentity(line)),
      type: 'assurance/overlay',
    });
  }

  function retryPendingSync(): void {
    if (!enabled) return;
    const failed = stateRef.current.queue.find(
      (entry) => entry.state === 'failed'
    );
    if (!failed) return;
    dispatch({
      generation: generationRef.current,
      operationId: failed.operationId,
      type: 'command/retry',
    });
  }

  function retryImport(): void {
    if (!enabled) return;
    const generation = generationRef.current;
    const current = stateRef.current;
    if (current.importStatus !== 'failed') return;
    const cached = getCartFromStorage(optionsRef.current.merchantSlug);
    if (cached.length === 0 || !current.confirmed) {
      // Nothing left to import, or no cart yet: re-run creation.
      createAttemptedRef.current = false;
      dispatch({ generation, type: 'import/started' });
      return;
    }
    const planned = planLegacyImport(
      cached,
      current.confirmed,
      current.confirmed.cartId
    );
    if (planned.kind === 'nothing') {
      dispatch({ generation, status: 'skipped', type: 'import/resolved' });
      return;
    }
    if (planned.kind === 'conflicts') {
      dispatch({
        conflicts: planned.conflicts,
        generation,
        type: 'import/conflicts',
      });
      return;
    }
    if (planned.kind === 'create') return;
    dispatch({
      generation,
      type: 'import/started',
      warnings: planned.warnings,
    });
    const entries = [
      ...planned.adds.map((add) => ({
        intent: {
          input: add.line,
          kind: 'add' as const,
          product: {} as Product,
          quantity: add.line.quantity,
          tempId: `imp-${add.operationId.slice(-8)}`,
        },
        operationId: add.operationId,
      })),
      ...planned.sets.map((set, index) => ({
        intent: {
          kind: 'set_quantity' as const,
          quantity: set.quantity,
          target: { kind: 'lineId' as const, lineId: set.lineId },
        },
        operationId: `import:${current.confirmed?.cartId}:set:${set.lineId}:${index}`,
      })),
    ];
    importOpIdsRef.current = new Set(entries.map((entry) => entry.operationId));
    dispatch({ entries, generation, type: 'import/enqueue' });
  }

  const cartCount = state.display.reduce(
    (sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0),
    0
  );
  const cartTotal = state.display.reduce((sum, item) => {
    const itemTotal =
      (item.negotiatedPrice ?? item.price) *
      (Number.isFinite(item.quantity) ? item.quantity : 0);
    const assuranceMultiplier =
      item.hasAssurance === true
        ? 1 + (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE)
        : 1;
    return sum + itemTotal * assuranceMultiplier;
  }, 0);

  if (!enabled) {
    return {
      addToCart: noop,
      cart: [],
      cartCount: 0,
      cartId: null,
      cartTotal: 0,
      clearCart: noop,
      importConflicts: [],
      importStatus: 'none',
      importWarnings: [],
      isHydrated: true,
      removeFromCart: noop,
      repriceLine: noop,
      retryImport: noop,
      retryPendingSync: noop,
      syncError: null,
      syncStatus: 'synced',
      toggleAssurance: noop,
      updateQuantity: noop,
      version: null,
    };
  }

  return {
    addToCart,
    cart: state.display,
    cartCount,
    cartId: state.cartId,
    cartTotal,
    clearCart,
    importConflicts: state.importConflicts,
    importStatus: state.importStatus,
    importWarnings: state.importWarnings,
    isHydrated: hydrated,
    removeFromCart,
    repriceLine,
    retryImport,
    retryPendingSync,
    syncError: state.syncError,
    syncStatus: deriveSyncStatus(state),
    toggleAssurance,
    updateQuantity,
    version: state.confirmed?.version ?? null,
  };
}
