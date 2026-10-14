import {
  type CartErrorCode,
  type CartItemIdentity,
  cartLineIdentity,
} from '@baci/shared/cart';
import { intentIdentity, MAX_CONFLICT_ATTEMPTS } from './shared-cart-display';
import {
  adoptSnapshot,
  dropEntriesAndCascade,
  resolveTempDependents,
  targetTempId,
  withDisplay,
} from './shared-cart-queue';
import {
  initialSharedCartState,
  type SharedCartAction,
  type SharedCartPendingEntry,
  type SharedCartState,
} from './shared-cart-state';

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
        importConflicts: [],
        importStatus: 'pending',
        importWarnings: action.warnings ?? [],
      };
    }
    case 'import/finished': {
      const adopted = adoptSnapshot(state, action.snapshot);
      return withDisplay({
        ...adopted,
        importConflicts: [],
        importStatus: 'done',
        unimportedCache: [],
      });
    }
    case 'import/resolved': {
      return withDisplay({
        ...state,
        importConflicts: [],
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

export * from './shared-cart-display';
export * from './shared-cart-import';
export * from './shared-cart-queue';
export * from './shared-cart-state';
