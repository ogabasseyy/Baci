import type {
  CartErrorCode,
  CartSnapshot,
  CartWarning,
} from '@baci/shared/cart';
export type SharedCartFetchResult =
  | { ok: true; snapshot: CartSnapshot; warnings: CartWarning[] }
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: CartSnapshot | null;
      retryable: boolean;
    };

export type SharedCartMutationResult =
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: null;
      retryable: false;
      admissionDenied: true;
      denialCode: string;
      attempted: boolean;
      priorOutcome: 'none' | 'csrf-rejected';
    }
  | {
      ok: true;
      snapshot: CartSnapshot;
      replayed: boolean;
      warnings: CartWarning[];
    }
  | {
      ok: false;
      code: CartErrorCode;
      snapshot: CartSnapshot | null;
      retryable: boolean;
    };
