import { createHash } from 'node:crypto';
import { unknownValueGuards } from '@/lib/unknown-value-guards';
import { agenticDvaCutoverConstants } from './agentic-dva-cutover-constants';
import { validateAgenticDvaCutoverSnapshot } from './agentic-dva-cutover-snapshot';
import type { AgenticCheckoutBuyer } from './checkout-completion-response';
import { getStoredCheckoutPaymentSnapshot } from './checkout-completion-response';
import { isValidOrderFinalizationClaim } from './checkout-order-finalization-claim-reference';
import type { AgenticMetadata } from './checkout-storage';
import {
  type RedactedCutoverValue,
  redactCutoverValue,
} from './redacted-cutover-value';

const { isRecord, nonEmptyString } = unknownValueGuards;
const CLAIMING_PAYMENT_STATE = agenticDvaCutoverConstants.claimingPaymentState;
const RESUMABLE_STATES = new Set<string>(
  agenticDvaCutoverConstants.resumableStates
);

type CutoverDisposition = 'manual_review' | 'resume_stored_account';

export interface CutoverActionPayload {
  currency: unknown;
  metadata: unknown;
  paymentReference: unknown;
  shippingAddress: unknown;
  shippingMethod: unknown;
}

export interface ResumeEvidence {
  buyer: AgenticCheckoutBuyer;
  dvaAccount: {
    account_name: string;
    account_number: string;
    bank_name: string;
  };
  finalizationClaim: string | null;
  metadata: AgenticMetadata;
  sessionCalc: NonNullable<ReturnType<typeof getStoredCheckoutPaymentSnapshot>>;
}

export interface CutoverAssessment {
  /** Sensitive operation data. JSON serialization is redacted; unwrap only at the mutation boundary. */
  actionPayload: RedactedCutoverValue<CutoverActionPayload> | null;
  disposition: CutoverDisposition;
  evidenceFingerprint: string;
  expectedUpdatedAt: string | null;
  merchantId: string | null;
  reason: string | null;
  resume: RedactedCutoverValue<ResumeEvidence> | null;
  sessionId: string | null;
  state: string | null;
}

export function assessAgenticDvaCutoverSession(
  input: unknown,
  now = new Date()
): CutoverAssessment {
  const record = isRecord(input) ? input : {};
  const evidenceFingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalize(input)) ?? 'null')
    .digest('hex');
  const metadata = isRecord(record.metadata) ? record.metadata : null;
  const agentic =
    metadata && isRecord(metadata.agentic) ? metadata.agentic : null;
  const state = stringOrNull(agentic?.payment_state);
  const base = {
    evidenceFingerprint,
    expectedUpdatedAt: stringOrNull(record.updated_at),
    merchantId: stringOrNull(record.merchant_id),
    sessionId: stringOrNull(record.session_id),
    state,
  };
  const manual = (reason: string): CutoverAssessment => ({
    ...base,
    actionPayload: null,
    disposition: 'manual_review',
    reason,
    resume: null,
  });

  if (!base.sessionId || !base.merchantId || !base.expectedUpdatedAt) {
    return manual('identity_or_timestamp_missing');
  }
  const updatedAtMs = Date.parse(base.expectedUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) return manual('updated_at_invalid');
  if (!metadata || !agentic) return manual('metadata_missing');
  if (!state) {
    return manual('state_not_transitional');
  }
  if (!['pending', 'processing'].includes(String(record.status))) {
    return manual('session_status_not_mutable');
  }
  if (record.order_id !== null && record.order_id !== undefined) {
    return manual('session_already_has_order');
  }

  if (state === CLAIMING_PAYMENT_STATE) {
    if (hasAccountEvidence(record, agentic)) {
      return manual('claim_has_account_evidence');
    }
    const claimReference = stringOrNull(record.payment_reference);
    if (!isExactClaimReference(claimReference, base.sessionId)) {
      return manual('claim_reference_invalid');
    }
    if (now.getTime() - updatedAtMs < agenticDvaCutoverConstants.claimStaleMs) {
      return manual('claim_not_stale');
    }
    // A missing local account cannot prove that the provider did not issue one.
    return manual('provider_outcome_unconfirmed');
  }

  if (!RESUMABLE_STATES.has(state)) {
    return manual('state_not_handled');
  }

  if (
    record.currency !== agenticDvaCutoverConstants.supportedCurrency ||
    record.payment_method !== 'bank_transfer' ||
    record.payment_provider !== 'paystack'
  ) {
    return manual('payment_identity_invalid');
  }

  const dvaAccount = parseStoredAccount(agentic.dva_account);
  if (!dvaAccount) return manual('stored_account_missing');
  if (
    record.payment_reference !== dvaAccount.account_number ||
    record.virtual_account_number !== dvaAccount.account_number ||
    record.virtual_account_name !== dvaAccount.account_name ||
    record.virtual_account_bank !== dvaAccount.bank_name
  ) {
    return manual('stored_account_mismatch');
  }

  const buyer = parseBuyer(agentic.buyer);
  const sessionCalc = getStoredCheckoutPaymentSnapshot(metadata);
  if (!buyer || !sessionCalc)
    return manual('buyer_or_payment_snapshot_missing');
  const snapshotError = validateAgenticDvaCutoverSnapshot(record, sessionCalc);
  if (snapshotError) return manual(snapshotError);
  if (!isRecord(record.shipping_address)) {
    return manual('fulfillment_snapshot_missing');
  }
  if (
    !matchesOptional(record.customer_email, buyer.email) ||
    !matchesOptional(record.customer_phone, buyer.phone_number) ||
    !matchesOptional(
      record.customer_name,
      `${buyer.first_name.trim()} ${buyer.last_name.trim()}`.trim()
    )
  ) {
    return manual('buyer_snapshot_mismatch');
  }

  const finalizationClaim = stringOrNull(agentic.finalization_claim);
  const finalizationOrderId = agentic.finalization_order_id;
  if (
    finalizationOrderId !== undefined &&
    finalizationOrderId !== null &&
    !nonEmptyString(finalizationOrderId)
  ) {
    return manual('finalization_order_id_invalid');
  }
  if (
    state === 'payment_account_ready' &&
    nonEmptyString(finalizationOrderId)
  ) {
    return manual('released_finalization_order_requires_review');
  }
  if (
    state === 'order_finalizing' &&
    (!finalizationClaim || !isValidOrderFinalizationClaim(finalizationClaim))
  ) {
    return manual('finalization_claim_missing');
  }
  if (state === 'order_finalizing' && !nonEmptyString(finalizationOrderId)) {
    return manual('finalization_order_marker_missing');
  }
  const resumeMetadata: AgenticMetadata = { ...metadata, agentic };

  return {
    ...base,
    actionPayload: redactCutoverValue(buildActionPayload(record)),
    disposition: 'resume_stored_account',
    reason: null,
    resume: redactCutoverValue({
      buyer,
      dvaAccount,
      finalizationClaim:
        state === 'order_finalizing' ? finalizationClaim : null,
      metadata: resumeMetadata,
      sessionCalc,
    }),
  };
}

function buildActionPayload(
  record: Record<string, unknown>
): CutoverActionPayload {
  return {
    currency: record.currency,
    metadata: record.metadata,
    paymentReference: record.payment_reference,
    shippingAddress: record.shipping_address,
    shippingMethod: record.shipping_method,
  };
}

function isExactClaimReference(
  claimReference: string | null,
  sessionId: string
): boolean {
  if (!claimReference) return false;
  const prefix = `agentic_claim_${sessionId}_`;
  if (!claimReference.startsWith(prefix)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    claimReference.slice(prefix.length)
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function hasAccountEvidence(
  record: Record<string, unknown>,
  agentic: Record<string, unknown>
): boolean {
  return (
    (agentic.dva_account !== null && agentic.dva_account !== undefined) ||
    [
      'payment_method',
      'payment_provider',
      'virtual_account_bank',
      'virtual_account_name',
      'virtual_account_number',
    ].some((key) => record[key] !== null && record[key] !== undefined)
  );
}

function matchesOptional(value: unknown, expected: string): boolean {
  return value === null || value === undefined || value === expected;
}

function parseBuyer(value: unknown): AgenticCheckoutBuyer | null {
  if (!isRecord(value)) return null;
  const email = nonEmptyString(value.email);
  const firstName = nonEmptyString(value.first_name);
  const lastName = nonEmptyString(value.last_name);
  const phoneNumber = nonEmptyString(value.phone_number);
  if (!email || !firstName || !lastName || !phoneNumber) return null;
  return {
    email,
    first_name: firstName,
    last_name: lastName,
    phone_number: phoneNumber,
  };
}

function parseStoredAccount(value: unknown) {
  if (!isRecord(value)) return null;
  const accountName = nonEmptyString(value.account_name);
  const accountNumber = nonEmptyString(value.account_number);
  const bankName = nonEmptyString(value.bank_name);
  if (
    !accountName ||
    !accountNumber ||
    !/^\d{10}$/.test(accountNumber) ||
    !bankName
  ) {
    return null;
  }
  return {
    account_name: accountName,
    account_number: accountNumber,
    bank_name: bankName,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
