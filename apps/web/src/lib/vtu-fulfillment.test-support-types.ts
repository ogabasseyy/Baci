import type { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';

/** Supabase client shape that fulfillPendingVtuTransaction receives. */
export type SupabaseStub = Parameters<
  typeof fulfillPendingVtuTransaction
>[0]['supabase'];

export interface PendingTransactionMockOptions {
  customerData?: {
    user_id: string | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  currentTransactionData?: Record<string, unknown> | null;
  existingCustomerCashback?: { balance_after: number } | null;
  existingMerchantCommission?: { id: string } | null;
  transactionRow: Record<string, unknown>;
  rpcImpl?: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>;
  merchantData?: {
    business_name?: string;
    slug?: string | null;
    support_email?: string | null;
  };
  claimData?: Record<string, unknown> | null;
  completedGatewayTransactions?: Array<{ status: string }>;
  emailClaimData?: { id: string } | null;
  /**
   * When null, the email-clear RPC resolves null (Codex R97 P2: the row
   * was reclaimed under a newer lease generation, so our stale clear
   * must leave the owner's lease untouched).
   */
  emailClearData?: { id: string } | null;
  /**
   * When null, the email-finalize RPC resolves null (Codex R127 P2:
   * same stale-generation semantics as the fenced clear — our merge
   * must revert the outcome keys too).
   */
  emailFinalizeData?: { id: string } | null;
  notificationClaimData?: { id: string } | null;
  purchaseUpdateData?: { id: string; updated_at?: string } | null;
  purchaseUpdateErrors?: Array<{ message: string } | null>;
  /**
   * When set, the Kuda-fallback marker write resolves with this
   * matched row (null = zero-match lost race, Codex R97 P1); all
   * other updates keep purchaseUpdateData. Lets one test lose the
   * fallback race while the claim/debit/marker succeed.
   */
  fallbackMarkerData?: { id: string } | null;
  /**
   * When set, pre-vend restore updates resolve as a CAS match ONLY
   * when the captured `updated_at` token equals this (Codex R65
   * 6ru4mQ) — otherwise they zero-match like a raced row.
   */
  expectedRestoreToken?: string;
  updateErrors?: {
    finalMetadata?: { message: string };
    purchase?: { message: string };
    submissionMarker?: { message: string };
    successMetadata?: { message: string };
  };
  /**
   * When set, the settlement-metadata merge re-read (the only
   * `metadata, updated_at` select) fails with this error (Codex
   * R103 P2) — every other select is unaffected.
   */
  metadataRereadError?: { message: string };
  /**
   * Rows returned by the claim_failed_vtu_retry RPC (Codex R114).
   * Defaults to a successful claim so existing retry tests keep
   * vending; script a refusal to test the lost-race paths.
   */
  retryClaimData?: Record<string, unknown>[] | null;
  retryClaimError?: { message: string } | null;
  /**
   * When set, customer_wallet_transactions reads serve this sequence
   * (then repeat the last) instead of existingCustomerCashback —
   * models a refund landing between the retry pre-check and the
   * post-claim re-read (Codex R114).
   */
  ledgerReadSequence?: ({ amount: number } | null)[];
  updatePayloads?: unknown[];
}
