import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlockedOrderPaymentOutcome } from './file-blocked-order-payment-review';

export interface FinalizeOrderGatewayPaymentArgs {
  supabase: SupabaseClient;
  transaction: FinalizeOrderGatewayPaymentTransaction;
  orderId: string;
  gateway: 'juicyway' | 'paystack' | 'korapay';
  reference: string;
  gatewayResponse: Record<string, unknown>;
  wonTransactionFlip: boolean;
  actor: string;
  scheduleAfter: (task: () => Promise<void>) => void;
  // Aborts the awaited network leg (the paid-email send) when the caller
  // runs under a pass deadline; unbounded callers leave it unset.
  signal?: AbortSignal;
  // Bounds the paid-email platform-sender fallback to the pass deadline
  // so it declines unless its own attempt fits; unset when unbounded.
  fallbackDeadlineMs?: number;
}

export type FinalizeOrderGatewayPaymentOutcome =
  | { kind: 'captured_held'; duplicate: boolean; reason: string }
  | { kind: 'capture_evidence_review'; duplicate: boolean; reason: string }
  | { kind: 'capture_hold_failed'; error: unknown }
  | { kind: 'completion_failed'; error: unknown }
  | BlockedOrderPaymentOutcome
  | { kind: 'order_fetch_failed'; error: unknown }
  | {
      kind: 'inventory_failed';
      payload: { code?: string; error?: string };
      status: number;
    }
  | { kind: 'inventory_cleanup_failed' }
  | {
      kind: 'completed';
      healed: boolean;
      orderNumber: string | null;
      // True when the atomic completion found the order already paid by
      // another transaction, so this capture settled without the normal
      // side effects. Callers working from a possibly-stale order
      // snapshot (cron sweeps) use this — not the snapshot — to decide
      // whether the capture is a possible duplicate charge.
      capturedOnPaidOrder?: boolean;
    };

export interface FinalizeOrderGatewayPaymentTransaction {
  id: string;
  order_id: string | null;
  merchant_id: string;
  amount: number | string | null;
  platform_fee: number | null;
  gateway_reference: string | null;
}
