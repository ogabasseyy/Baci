import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readWalletPayRecoveryRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import { findWalletPaymentForPurchase } from '@/lib/piggyvest/wallet-pay-service';
import {
  findLookupByIdempotencyKey,
  type ImeiLookupRow,
  type mapExistingLookup,
} from '../route-helpers';

/** The replay context the IMEI route already builds for this request. */
type ReplayContext = Parameters<typeof mapExistingLookup>[1];

// Payments that moved (or hold) money: their check must still be delivered.
const MONEY_MOVED = new Set([
  'reserved',
  'dispatched',
  'confirmed',
  'needs_review',
]);

export interface ResumePaidImeiWalletPaymentDeps {
  readRuntime: typeof readWalletPayRecoveryRuntime;
  resolveIdentity: (input: {
    supabase: SupabaseClient;
    user: User;
    merchantId: string;
  }) => Promise<{
    merchantId: string;
    customerId: string;
    userId: string;
  } | null>;
  findForPurchase: typeof findWalletPaymentForPurchase;
}

const defaultDeps: ResumePaidImeiWalletPaymentDeps = {
  readRuntime: readWalletPayRecoveryRuntime,
  resolveIdentity: (input) =>
    resolvePrimaryWalletIdentity({ ...input, forOnboarding: false }),
  findForPurchase: findWalletPaymentForPurchase,
};

/**
 * A replayed PiggyVest IMEI start whose provider preflight failed (a tier
 * paused, a provider key missing): if this same request's lookup already
 * has a payment that moved money, hand its operation back so the client can
 * re-check it and the check is delivered, instead of a 503 that leaves the
 * drain to refund it (Codex P2). Never issues a payment; null = no such
 * payment, so the preflight answer stands. Runs on the recovery runtime so a
 * paid check resumes even while wallet pay is switched off.
 */
export async function resumePaidImeiWalletPayment(
  input: ReplayContext & {
    existing: ImeiLookupRow;
    supabase: SupabaseClient;
    user: User;
  },
  deps: ResumePaidImeiWalletPaymentDeps = defaultDeps
): Promise<Response | null> {
  const { existing } = input;
  // Only this same request (customer, IMEI, tier and device) resumes.
  if (
    existing.status !== 'pending' ||
    existing.customer_id !== input.customerId ||
    existing.imei_hash !== input.imeiHash ||
    existing.tier !== input.tier ||
    (existing.device_category ?? null) !== (input.deviceCategory ?? null)
  )
    return null;
  let runtime: ReturnType<typeof readWalletPayRecoveryRuntime>;
  try {
    runtime = deps.readRuntime();
  } catch {
    return null;
  }
  if (runtime.merchantId !== input.merchantId) return null;
  const identity = await deps.resolveIdentity({
    supabase: input.supabase,
    user: input.user,
    merchantId: input.merchantId,
  });
  if (!identity || identity.customerId !== input.customerId) return null;
  const owned = await deps.findForPurchase({
    runtime,
    scope: walletPayScope(runtime, identity),
    purpose: 'imei_check',
    purchaseRef: String(existing.id),
  });
  if (!owned || !MONEY_MOVED.has(owned.state)) return null;
  return NextResponse.json(
    {
      status:
        owned.state === 'needs_review' ? 'payment_review' : 'payment_pending',
      lookupId: String(existing.id),
      operationId: owned.operationId,
      amountKobo: Math.round(Number(existing.amount_ngn) * 100),
    },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * A PiggyVest IMEI start while wallet pay is switched off: if it replays a
 * start (same Idempotency-Key) whose payment already moved money, resume it
 * on the recovery runtime so the check is delivered (Codex P2). Never issues
 * a payment; null = nothing to resume (the caller answers unavailable).
 */
export async function resumeWhileSwitchedOff(
  input: {
    idempotencyKey: string;
    replayContext: ReplayContext;
    supabase: SupabaseClient;
    supabaseAdmin: ImeiAccessClient;
    user: User;
  },
  resume: typeof resumePaidImeiWalletPayment = resumePaidImeiWalletPayment
): Promise<Response | null> {
  const existing = await findLookupByIdempotencyKey(
    input.supabaseAdmin,
    input.idempotencyKey
  ).catch(() => null);
  if (!existing) return null;
  return await resume({
    ...input.replayContext,
    existing,
    supabase: input.supabase,
    user: input.user,
  }).catch(() => null);
}
