import type {
  CartErrorCode,
  CartInputLine,
  CartSnapshot,
} from '@baci/shared/cart';

import type { CartMergeConflict } from '@/lib/cart/merge';

import type { Product } from '@/lib/products';

import type {
  AddToCartOptions,
  CartItem,
  SharedCartDisplayItem,
  SharedCartImportStatus,
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
  | {
      kind: 'set_assurance';
      target: SharedCartLineTarget;
      hasAssurance: boolean;
    }
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
