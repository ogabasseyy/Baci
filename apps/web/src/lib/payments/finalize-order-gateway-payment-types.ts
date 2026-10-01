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
  | { kind: 'completed'; healed: boolean; orderNumber: string | null };

export interface FinalizeOrderGatewayPaymentTransaction {
  id: string;
  order_id: string | null;
  merchant_id: string;
  amount: number | string | null;
  platform_fee: number | null;
  gateway_reference: string | null;
}
