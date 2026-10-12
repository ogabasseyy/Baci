import {
  type CartErrorCode,
  type CartInputLine,
  type CartItemIdentity,
  type CartLine,
  type CartSnapshot,
  cartLineIdentity,
  SHARED_CART_MAX_LINES,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';
import { type CartMergeConflict, planCartMerge } from '@/lib/cart/merge';
import type { Product } from '@/lib/products';
import type {
  AddToCartOptions,
  CartItem,
  SharedCartDisplayItem,
  SharedCartImportStatus,
  SharedCartSyncStatus,
} from './cart-types';

export type SharedCartLineTarget =
  | { kind: 'lineId'; lineId: string }
  | { kind: 'temp'; tempId: string }
  | { kind: 'identity'; key: string };

export interface SharedCartAddAttachments {
  negotiatedUnitPriceMinor?: number;
  negotiationStatus?: 'pending' | 'accepted' | 'rejected';
  voucherToken?: string;
  voucherAwardId?: string;
}

export type SharedCartIntent =
  | {
      kind: 'add';
      tempId: string;
      product: Product;
      quantity: number;
      options?: AddToCartOptions;
      attachments?: SharedCartAddAttachments;
      /**
       * Prebuilt server input for import entries: the sender transmits
       * it verbatim instead of rebuilding identity and attachments.
       */
      input?: CartInputLine;
    }
  | { kind: 'set_quantity'; target: SharedCartLineTarget; quantity: number }
  | { kind: 'remove'; target: SharedCartLineTarget }
  | { kind: 'clear' };

export type SharedCartEntryState = 'queued' | 'sending' | 'failed';

export interface SharedCartPendingEntry {
  operationId: string;
  intent: SharedCartIntent;
  attempts: number;
  state: SharedCartEntryState;
  /**
   * Silent entries send through the same queue but never alter the
   * display: the legacy import's effect is already visible via the
   * unimported cache, so re-applying it would double-count.
   */
  silent?: boolean;
  /**
   * Temp line this entry waits on. The sender holds the entry until the
   * temp resolves to a stable server line id, so a set_quantity issued
   * before its add confirms never addresses a line id that cannot exist.
   */
  blockedOnTempId?: string;
}

export interface SharedCartState {
  generation: number;
  merchantId: string;
  cartId: string | null;
  confirmed: CartSnapshot | null;
  display: SharedCartDisplayItem[];
  /** Catalog shells keyed by cartLineIdentity. */
  products: Record<string, Product>;
  queue: SharedCartPendingEntry[];
  syncError: CartErrorCode | null;
  importStatus: SharedCartImportStatus;
  importConflicts: CartMergeConflict[];
  importWarnings: string[];
  /** Display-local assurance choices keyed by line identity. */
  assuranceOverlays: Record<string, boolean>;
  /**
   * Legacy cache lines not yet imported. Shown until the import
   * resolves so adoption never flashes them away and back.
   */
  unimportedCache: CartItem[];
}

export const initialSharedCartState: SharedCartState = {
  assuranceOverlays: {},
  cartId: null,
  confirmed: null,
  display: [],
  generation: 0,
  importConflicts: [],
  importStatus: 'none',
  importWarnings: [],
  merchantId: '',
  products: {},
  queue: [],
  syncError: null,
  unimportedCache: [],
};

export type SharedCartAction =
  | {
      type: 'link/start';
      generation: number;
      merchantId: string;
      cached: CartItem[];
      products: Record<string, Product>;
    }
  | { type: 'link/snapshot'; generation: number; snapshot: CartSnapshot }
  | {
      type: 'command/enqueue';
      generation: number;
      entry: {
        operationId: string;
        intent: SharedCartIntent;
        silent?: boolean;
      };
    }
  | {
      type: 'import/enqueue';
      generation: number;
      entries: { operationId: string; intent: SharedCartIntent }[];
    }
  | { type: 'command/sending'; generation: number; operationId: string }
  | {
      type: 'command/reconciled';
      generation: number;
      operationId: string;
      snapshot: CartSnapshot;
    }
  | {
      type: 'command/conflict';
      generation: number;
      operationId: string;
      snapshot: CartSnapshot;
    }
  | {
      type: 'command/failed';
      generation: number;
      operationId: string;
      code: CartErrorCode;
      retryable: boolean;
    }
  | { type: 'command/retry'; generation: number; operationId: string }
  | { type: 'snapshot/polled'; generation: number; snapshot: CartSnapshot }
  | {
      type: 'products/hydrated';
      generation: number;
      products: Record<string, Product>;
    }
  | { type: 'import/started'; generation: number; warnings?: string[] }
  | {
      type: 'import/finished';
      generation: number;
      snapshot: CartSnapshot;
      lineCount: number;
    }
  | {
      type: 'import/resolved';
      generation: number;
      status: 'done' | 'skipped';
    }
  | {
      type: 'import/conflicts';
      generation: number;
      conflicts: CartMergeConflict[];
    }
  | { type: 'import/failed'; generation: number; code: CartErrorCode }
  | {
      type: 'assurance/overlay';
      generation: number;
      lineKey: string;
      hasAssurance: boolean;
    }
  | { type: 'session/reset'; generation: number; merchantId: string };

const MAX_CONFLICT_ATTEMPTS = 3;

export function deriveSyncStatus(state: SharedCartState): SharedCartSyncStatus {
  if (state.queue.some((entry) => entry.state === 'failed')) return 'retrying';
  if (state.queue.length > 0) return 'pending';
  if (state.syncError) return 'error';
  return 'synced';
}

export interface SharedCartIdentitySource {
  id: string;
  variantId?: string;
  condition?: string;
  variantAttributes?: Record<string, string>;
  selectedColor?: string;
  selectedColorValue?: string;
  secondaryColor?: string;
  secondaryColorValue?: string;
  selectedStorage?: string;
}

function isCartCondition(
  value: string | undefined
): value is NonNullable<CartItemIdentity['condition']> {
  return (
    value === 'new' ||
    value === 'used' ||
    value === 'open_box' ||
    value === 'refurbished'
  );
}

/**
 * Server identity for a display line. Color/storage selections fold into
 * options so two legacy variants of one product stay distinct lines.
 */
export function cartItemToIdentity(
  item: SharedCartIdentitySource
): CartItemIdentity {
  const options: Record<string, string> = { ...(item.variantAttributes ?? {}) };
  if (item.selectedColor) options.color = item.selectedColor;
  if (item.selectedColorValue) options.colorValue = item.selectedColorValue;
  if (item.secondaryColor) options.secondaryColor = item.secondaryColor;
  if (item.secondaryColorValue) {
    options.secondaryColorValue = item.secondaryColorValue;
  }
  if (item.selectedStorage) options.storage = item.selectedStorage;
  const identity: CartItemIdentity = { productId: item.id };
  if (item.variantId) identity.variantId = item.variantId;
  if (isCartCondition(item.condition)) identity.condition = item.condition;
  if (Object.keys(options).length > 0) identity.options = options;
  return identity;
}

function identityKeyOfDisplay(item: SharedCartDisplayItem): string {
  return cartLineIdentity(cartItemToIdentity(item));
}

function minorToMajor(minor: number): number {
  return minor / 100;
}

function fallbackProduct(productId: string): Product {
  return {
    brand: '',
    description: '',
    gtin: '',
    id: productId,
    image: '',
    imageHint: '',
    imageLarge: '',
    manage_stock: false,
    mpn: '',
    name: 'Unavailable item',
    price: 0,
    slug: productId,
    status: 'active',
    stock: 0,
  } as Product;
}

function confirmedLineToDisplay(
  line: CartLine,
  products: Record<string, Product>
): SharedCartDisplayItem {
  const key = cartLineIdentity(line.item);
  const product = products[key] ?? fallbackProduct(line.item.productId);
  const options = line.item.options ?? {};
  const {
    color,
    colorValue,
    secondaryColor,
    secondaryColorValue,
    storage,
    ...rest
  } = options;
  const display: SharedCartDisplayItem = {
    ...(product as CartItem),
    cartItemId: line.id,
    condition: line.item.condition,
    hydrationFailed: products[key] ? undefined : true,
    id: line.item.productId,
    pendingTempId: null,
    price: minorToMajor(line.unitPriceMinor),
    quantity: line.quantity,
    quizAwardId: line.voucherAwardId,
    quizVoucherToken: line.voucherToken,
    secondaryColor,
    secondaryColorValue,
    selectedColor: color,
    selectedColorValue: colorValue,
    selectedStorage: storage,
    serverLineId: line.id,
    variantAttributes:
      Object.keys(rest).length > 0
        ? (rest as Record<string, string>)
        : undefined,
    variantId: line.item.variantId,
  };
  // Unconditional resets: the cached product shell may carry stale
  // negotiated or assurance fields that the server snapshot refutes.
  display.negotiatedPrice =
    line.negotiatedUnitPriceMinor != null
      ? minorToMajor(line.negotiatedUnitPriceMinor)
      : undefined;
  display.negotiationStatus = line.negotiationStatus ?? 'none';
  display.hasAssurance = line.hasAssurance ?? false;
  display.assuranceRate = line.assuranceRate ?? undefined;
  return display;
}

function intentIdentity(intent: SharedCartIntent): CartItemIdentity | null {
  if (intent.kind !== 'add') return null;
  if (intent.input) return intent.input.item;
  return cartItemToIdentity({
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
}

function findDisplayIndex(
  display: SharedCartDisplayItem[],
  target: SharedCartLineTarget
): number {
  if (target.kind === 'temp') {
    return display.findIndex((line) => line.pendingTempId === target.tempId);
  }
  if (target.kind === 'identity') {
    return display.findIndex(
      (line) => identityKeyOfDisplay(line) === target.key
    );
  }
  return display.findIndex(
    (line) =>
      line.serverLineId === target.lineId || line.cartItemId === target.lineId
  );
}

function optimisticAddLine(
  intent: Extract<SharedCartIntent, { kind: 'add' }>
): SharedCartDisplayItem {
  const options = intent.options;
  const attachments = intent.attachments;
  return {
    ...(intent.product as CartItem),
    cartItemId: `temp:${intent.tempId}`,
    condition: isCartCondition(options?.condition)
      ? options?.condition
      : undefined,
    negotiatedPrice:
      attachments?.negotiatedUnitPriceMinor != null
        ? minorToMajor(attachments.negotiatedUnitPriceMinor)
        : undefined,
    negotiationStatus: attachments?.negotiationStatus ?? 'none',
    pendingTempId: intent.tempId,
    quantity: intent.quantity,
    quizAwardId: attachments?.voucherAwardId ?? options?.quizAwardId,
    quizVoucherToken: attachments?.voucherToken ?? options?.quizVoucherToken,
    secondaryColor: options?.secondaryColor,
    secondaryColorValue: options?.secondaryColorValue,
    selectedColor: options?.color,
    selectedColorValue: options?.colorValue,
    selectedStorage: options?.storage,
    serverLineId: null,
    variantAttributes: options?.variantAttributes,
    variantId: options?.variantId,
  };
}

function applyIntent(
  display: SharedCartDisplayItem[],
  entry: SharedCartPendingEntry
): SharedCartDisplayItem[] {
  if (entry.silent) return display;
  const intent = entry.intent;
  if (intent.kind === 'clear') return [];
  if (intent.kind === 'add') {
    const key = cartLineIdentity(intentIdentity(intent) as CartItemIdentity);
    const index = display.findIndex(
      (line) => identityKeyOfDisplay(line) === key
    );
    if (index === -1) {
      return [...display, optimisticAddLine(intent)];
    }
    return display.map((line, lineIndex) =>
      lineIndex === index
        ? {
            ...line,
            pendingTempId: line.pendingTempId ?? intent.tempId,
            quantity: line.quantity + intent.quantity,
          }
        : line
    );
  }
  const index = findDisplayIndex(display, intent.target);
  if (index === -1) return display;
  if (intent.kind === 'remove') {
    return display.filter((_, lineIndex) => lineIndex !== index);
  }
  // A quantity edit never claims a temp id: temp targets resolve only
  // when an add reconciles, so a claim here would strand the next edit
  // on the same line behind an unresolvable block.
  return display.map((line, lineIndex) =>
    lineIndex === index ? { ...line, quantity: intent.quantity } : line
  );
}

function deriveDisplay(state: SharedCartState): SharedCartDisplayItem[] {
  const lines = (state.confirmed?.lines ?? []).map((line) =>
    confirmedLineToDisplay(line, state.products)
  );
  const confirmedKeys = new Set(
    (state.confirmed?.lines ?? []).map((line) => cartLineIdentity(line.item))
  );
  // Unimported cache lines stay visible until the import resolves, but
  // overlapping identities defer to the confirmed line: no duplicates,
  // and the pending status marks the transient quantities.
  for (const cached of state.unimportedCache) {
    if (confirmedKeys.has(cartLineIdentity(cartItemToIdentity(cached)))) {
      continue;
    }
    lines.push({
      ...(cached as SharedCartDisplayItem),
      pendingTempId: null,
      serverLineId: (cached as SharedCartDisplayItem).serverLineId ?? null,
    });
  }
  const applied = state.queue.reduce(applyIntent, lines);
  if (Object.keys(state.assuranceOverlays).length === 0) return applied;
  return applied.map((line) => {
    const overlay = state.assuranceOverlays[identityKeyOfDisplay(line)];
    return overlay === undefined ? line : { ...line, hasAssurance: overlay };
  });
}

function withDisplay(state: SharedCartState): SharedCartState {
  return { ...state, display: deriveDisplay(state) };
}

/**
 * Adopts a snapshot only when it belongs to this merchant and is not
 * older than the confirmed state. Equal versions adopt idempotently;
 * lower versions are rejected so an old replay never overwrites newer
 * state within a generation.
 */
function adoptSnapshot(
  state: SharedCartState,
  snapshot: CartSnapshot
): SharedCartState {
  if (snapshot.merchantId !== state.merchantId) return state;
  const current = state.confirmed?.version ?? -1;
  if (snapshot.version < current) return state;
  return { ...state, cartId: snapshot.cartId, confirmed: snapshot };
}

function tempsCreatedBy(entry: SharedCartPendingEntry): string[] {
  return entry.intent.kind === 'add' ? [entry.intent.tempId] : [];
}

/**
 * Drops entries and transitively drops anything blocked on a temp that
 * will now never resolve. Returns the surviving queue plus every temp
 * that lost its provider.
 */
function dropEntriesAndCascade(
  queue: SharedCartPendingEntry[],
  operationIds: Set<string>
): { queue: SharedCartPendingEntry[]; droppedTemps: string[] } {
  const dropped = new Set(operationIds);
  const droppedTemps = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of queue) {
      if (dropped.has(entry.operationId)) {
        for (const tempId of tempsCreatedBy(entry)) {
          if (!droppedTemps.has(tempId)) {
            droppedTemps.add(tempId);
            grew = true;
          }
        }
      } else if (
        entry.blockedOnTempId !== undefined &&
        droppedTemps.has(entry.blockedOnTempId)
      ) {
        dropped.add(entry.operationId);
        grew = true;
      }
    }
  }
  return {
    droppedTemps: [...droppedTemps],
    queue: queue.filter((entry) => !dropped.has(entry.operationId)),
  };
}

function resolveTempDependents(
  queue: SharedCartPendingEntry[],
  tempId: string,
  lineId: string | null
): SharedCartPendingEntry[] {
  if (lineId === null) {
    const blocked = new Set(
      queue
        .filter((entry) => entry.blockedOnTempId === tempId)
        .map((entry) => entry.operationId)
    );
    return dropEntriesAndCascade(queue, blocked).queue;
  }
  return queue.map((entry) => {
    if (entry.blockedOnTempId !== tempId) return entry;
    const intent = entry.intent;
    const next: SharedCartPendingEntry = { ...entry };
    delete next.blockedOnTempId;
    if (
      (intent.kind === 'set_quantity' || intent.kind === 'remove') &&
      intent.target.kind === 'temp' &&
      intent.target.tempId === tempId
    ) {
      next.intent = {
        ...intent,
        target: { kind: 'lineId', lineId },
      } as SharedCartPendingEntry['intent'];
    }
    return next;
  });
}

function targetTempId(intent: SharedCartIntent): string | undefined {
  if (intent.kind === 'set_quantity' || intent.kind === 'remove') {
    return intent.target.kind === 'temp' ? intent.target.tempId : undefined;
  }
  return undefined;
}

export function sharedCartReducer(
  state: SharedCartState,
  action: SharedCartAction
): SharedCartState {
  switch (action.type) {
    case 'link/start': {
      const next: SharedCartState = {
        ...initialSharedCartState,
        generation: action.generation,
        merchantId: action.merchantId,
        products: action.products,
        unimportedCache: action.cached,
      };
      return withDisplay(next);
    }
    case 'session/reset': {
      return {
        ...initialSharedCartState,
        generation: action.generation,
        merchantId: action.merchantId,
      };
    }
    default:
      break;
  }

  if (action.generation !== state.generation) return state;

  switch (action.type) {
    case 'link/snapshot':
    case 'snapshot/polled': {
      return withDisplay(adoptSnapshot(state, action.snapshot));
    }
    case 'command/enqueue': {
      const blockedOnTempId = targetTempId(action.entry.intent);
      const entry: SharedCartPendingEntry = {
        attempts: 0,
        blockedOnTempId,
        intent: action.entry.intent,
        operationId: action.entry.operationId,
        silent: action.entry.silent,
        state: 'queued',
      };
      return withDisplay({ ...state, queue: [...state.queue, entry] });
    }
    case 'import/enqueue': {
      // The import block jumps the head as one silent unit, so user
      // actions enqueued during adoption send after the baseline they
      // were planned against, in plan order.
      const block: SharedCartPendingEntry[] = action.entries.map((item) => ({
        attempts: 0,
        blockedOnTempId: targetTempId(item.intent),
        intent: item.intent,
        operationId: item.operationId,
        silent: true,
        state: 'queued',
      }));
      return withDisplay({ ...state, queue: [...block, ...state.queue] });
    }
    case 'command/sending': {
      const queue = state.queue.map((entry) =>
        entry.operationId === action.operationId
          ? { ...entry, state: 'sending' as const }
          : entry
      );
      return { ...state, queue };
    }
    case 'command/reconciled': {
      const entry = state.queue.find(
        (candidate) => candidate.operationId === action.operationId
      );
      const adopted = adoptSnapshot(state, action.snapshot);
      // Drop only the reconciled entry first: its temp still resolves
      // dependents below, so the fatal-drop cascade must not run here.
      let queue = adopted.queue.filter(
        (candidate) => candidate.operationId !== action.operationId
      );
      let syncError: CartErrorCode | null = null;
      if (entry?.intent.kind === 'add') {
        const identity = intentIdentity(entry.intent) as CartItemIdentity;
        const key = cartLineIdentity(identity);
        const match = (adopted.confirmed?.lines ?? []).find(
          (line) => cartLineIdentity(line.item) === key
        );
        const before = queue.length;
        queue = resolveTempDependents(
          queue,
          entry.intent.tempId,
          match?.id ?? null
        );
        if (queue.length < before) syncError = 'not_found';
      }
      return withDisplay({ ...adopted, queue, syncError });
    }
    case 'command/conflict': {
      const adopted = adoptSnapshot(state, action.snapshot);
      const entry = adopted.queue.find(
        (candidate) => candidate.operationId === action.operationId
      );
      if (!entry) return withDisplay(adopted);
      const attempts = entry.attempts + 1;
      if (attempts > MAX_CONFLICT_ATTEMPTS) {
        const dropped = dropEntriesAndCascade(
          adopted.queue,
          new Set([action.operationId])
        );
        return withDisplay({
          ...adopted,
          queue: dropped.queue,
          syncError: 'version_conflict',
        });
      }
      const queue = adopted.queue.map((candidate) =>
        candidate.operationId === action.operationId
          ? { ...candidate, attempts, state: 'queued' as const }
          : candidate
      );
      return withDisplay({ ...adopted, queue });
    }
    case 'command/failed': {
      if (!action.retryable) {
        const dropped = dropEntriesAndCascade(
          state.queue,
          new Set([action.operationId])
        );
        return withDisplay({
          ...state,
          queue: dropped.queue,
          syncError: action.code,
        });
      }
      const queue = state.queue.map((entry) =>
        entry.operationId === action.operationId
          ? { ...entry, attempts: entry.attempts + 1, state: 'failed' as const }
          : entry
      );
      return withDisplay({ ...state, queue, syncError: action.code });
    }
    case 'command/retry': {
      const queue = state.queue.map((entry) =>
        entry.operationId === action.operationId
          ? { ...entry, state: 'queued' as const }
          : entry
      );
      return withDisplay({ ...state, queue });
    }
    case 'products/hydrated': {
      return withDisplay({
        ...state,
        products: { ...state.products, ...action.products },
      });
    }
    case 'import/started': {
      return {
        ...state,
        importStatus: 'pending',
        importWarnings: action.warnings ?? [],
      };
    }
    case 'import/finished': {
      const adopted = adoptSnapshot(state, action.snapshot);
      return withDisplay({
        ...adopted,
        importStatus: 'done',
        unimportedCache: [],
      });
    }
    case 'import/resolved': {
      return withDisplay({
        ...state,
        importStatus: action.status,
        unimportedCache: [],
      });
    }
    case 'import/conflicts': {
      return withDisplay({
        ...state,
        importConflicts: action.conflicts,
        importStatus: 'failed',
      });
    }
    case 'import/failed': {
      // The server snapshot stands alone now; the cache stays in storage
      // for an explicit retry but leaves the display.
      return withDisplay({
        ...state,
        importStatus: 'failed',
        syncError: action.code,
        unimportedCache: [],
      });
    }
    case 'assurance/overlay': {
      return withDisplay({
        ...state,
        assuranceOverlays: {
          ...state.assuranceOverlays,
          [action.lineKey]: action.hasAssurance,
        },
      });
    }
  }
}

/**
 * Converts a display line to a server input line. Quantities clamp to
 * the canonical per-line bound, voucher lines pin to one, and a
 * negotiated price without a settled status is dropped rather than
 * sent as an authoritative-looking half attachment.
 */
export function displayLineToInputLine(item: CartItem): CartInputLine {
  const line: CartInputLine = {
    item: cartItemToIdentity(item),
    quantity: Math.min(
      SHARED_CART_MAX_QUANTITY_PER_LINE,
      Math.max(1, Math.round(item.quantity))
    ),
  };
  if (item.quizVoucherToken) line.voucherToken = item.quizVoucherToken;
  if (item.quizAwardId) line.voucherAwardId = item.quizAwardId;
  if (line.voucherToken ?? line.voucherAwardId) line.quantity = 1;
  if (
    item.negotiationStatus === 'pending' ||
    item.negotiationStatus === 'accepted' ||
    item.negotiationStatus === 'rejected'
  ) {
    line.negotiationStatus = item.negotiationStatus;
    if (
      typeof item.negotiatedPrice === 'number' &&
      Number.isFinite(item.negotiatedPrice) &&
      item.negotiatedPrice > 0
    ) {
      line.negotiatedUnitPriceMinor = Math.round(item.negotiatedPrice * 100);
    }
  }
  return line;
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type PlannedLegacyImport =
  | { kind: 'nothing' }
  | {
      kind: 'create';
      lines: CartInputLine[];
      operationId: string;
      warnings: string[];
    }
  | {
      kind: 'commands';
      adds: { line: CartInputLine; operationId: string }[];
      sets: { lineId: string; quantity: number }[];
      warnings: string[];
    }
  | { kind: 'conflicts'; conflicts: CartMergeConflict[] };

function inputLinesOf(items: CartItem[]): {
  lines: CartInputLine[];
  clamped: boolean;
} {
  let clamped = false;
  const lines = items.map((item) => {
    const line = displayLineToInputLine(item);
    if (line.quantity !== Math.max(1, Math.round(item.quantity))) {
      clamped = true;
    }
    return line;
  });
  return { clamped, lines };
}

function syntheticIncoming(lines: CartInputLine[]): CartSnapshot {
  return {
    cartId: 'import-incoming',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(0).toISOString(),
    lines: lines.map(
      (line, index) =>
        ({
          hasAssurance: false,
          id: `import-${index}`,
          item: line.item,
          lineTotalMinor: 0,
          negotiatedUnitPriceMinor: line.negotiatedUnitPriceMinor,
          negotiationStatus: line.negotiationStatus,
          quantity: line.quantity,
          unitPriceMinor: 0,
          voucherAwardId: line.voucherAwardId,
          voucherToken: line.voucherToken,
        }) as CartLine
    ),
    merchantId: 'import-incoming',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 0,
  };
}

/**
 * Plans the one-time legacy import through the Task 6 merge rules: an
 * empty server takes every local line, a nonempty server takes the
 * merge diff (adds plus max-quantity sets), and conflicting
 * voucher/negotiation attachments report for explicit resolution
 * instead of silently overwriting. Derived operation keys make import
 * retries converge instead of duplicating.
 */
export function planLegacyImport(
  local: CartItem[],
  server: CartSnapshot | null,
  cartId: string | null
): PlannedLegacyImport {
  if (local.length === 0) return { kind: 'nothing' };
  const { clamped, lines } = inputLinesOf(local);
  const warnings: string[] = [];
  if (clamped) warnings.push('quantity_clamped');

  if (!server || !cartId) {
    const truncated =
      lines.length > SHARED_CART_MAX_LINES
        ? lines.slice(0, SHARED_CART_MAX_LINES)
        : lines;
    if (truncated.length < lines.length) warnings.push('too_many_lines');
    const fingerprint = truncated
      .map((line) => `${cartLineIdentity(line.item)}:${line.quantity}`)
      .sort()
      .join('|');
    return {
      kind: 'create',
      lines: truncated,
      operationId: `import:create:${fnv1aHex(fingerprint)}`,
      warnings,
    };
  }

  const serverKeys = new Set(
    server.lines.map((line) => cartLineIdentity(line.item))
  );
  const overlapping = lines.filter((line) =>
    serverKeys.has(cartLineIdentity(line.item))
  );
  const incomingOnly = lines.filter(
    (line) => !serverKeys.has(cartLineIdentity(line.item))
  );
  // Server lines win their slots; local-only lines fill what remains.
  const capacity = Math.max(0, SHARED_CART_MAX_LINES - server.lines.length);
  const keptIncomingOnly = incomingOnly.slice(0, capacity);
  if (keptIncomingOnly.length < incomingOnly.length) {
    warnings.push('too_many_lines');
  }
  const planned = planCartMerge(
    server,
    syntheticIncoming([...overlapping, ...keptIncomingOnly])
  );
  if (!planned.ok) {
    if (planned.code === 'merge_conflict') {
      return { conflicts: planned.conflicts, kind: 'conflicts' };
    }
    return { conflicts: [], kind: 'conflicts' };
  }
  const serverByKey = new Map(
    server.lines.map((line) => [cartLineIdentity(line.item), line])
  );
  const adds: { line: CartInputLine; operationId: string }[] = [];
  const sets: { lineId: string; quantity: number }[] = [];
  for (const line of planned.lines) {
    const key = cartLineIdentity(line.item);
    const existing = serverByKey.get(key);
    if (!existing) {
      adds.push({
        line,
        operationId: `import:${cartId}:${fnv1aHex(key)}`,
      });
    } else if (existing.quantity !== line.quantity) {
      sets.push({ lineId: existing.id, quantity: line.quantity });
    }
  }
  return { adds, kind: 'commands', sets, warnings };
}
