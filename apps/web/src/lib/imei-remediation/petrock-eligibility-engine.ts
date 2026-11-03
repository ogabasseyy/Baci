import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  canAssessImeiNetworkUnlock,
  getImeiBlacklistState,
} from '@baci/shared/imei';
import type { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { isDefinitivePetrockSubmissionRejection } from '@/lib/imei-providers/petrock/petrock-submission-outcome';
import {
  isRetryablePetrockStateWriteError,
  retryPetrockStateWrite,
} from '@/lib/imei-providers/petrock/retry-petrock-state-write';
import {
  getPetrockEligibilityRequiredChecks,
  type PetrockEligibilityCheckKind,
} from './petrock-remediation-eligibility';
import { normalizePetrockRemediationCarrier } from './petrock-remediation-product-parser';

type PetrockClient = ReturnType<typeof createPetrockClient>;

interface EligibilityOrder {
  eligibilityChecksCompleted: readonly string[];
  eligibilityEvidence: Record<string, string | undefined>;
  id: string;
}

interface EligibilityProductSnapshot {
  active: boolean;
  currency: string;
  orderFieldName: string | null;
  priceUsd: number | null;
  productId: string;
  syncedAt: string;
}

export interface PetrockEligibilitySubmissionState {
  begin(input: {
    check: PetrockEligibilityCheckKind;
    feedbackTokenHash: string;
    orderId: string;
    referenceId: string;
  }): Promise<boolean>;
  markSubmissionUnknown(input: {
    orderId: string;
    providerOrderId?: string;
    reason: string;
  }): Promise<boolean>;
  recordSubmission(input: {
    nextPollAt: string;
    orderId: string;
    providerOrderId: string;
    providerStatus: string;
  }): Promise<boolean>;
  suppress(input: {
    message: string;
    orderId: string;
    reason: string;
  }): Promise<boolean>;
}

const HOUSE_CHECK_PRODUCTS: Partial<
  Record<Exclude<PetrockEligibilityCheckKind, 'carrier_status'>, string>
> = {
  // No verified blacklist house-check replacement: never dispatch rejected 1955.
  // Current carrier + SIM-lock product; the previous product 693 is no longer listed.
  carrier_detection: '689',
};

function carrierStatusProduct(evidence: Record<string, string | undefined>) {
  const carrier = normalizePetrockRemediationCarrier(evidence.carrier ?? '');
  if (carrier === 'AT&T') return '1957';
  if (carrier === 'T-Mobile US') return '746';
  if (carrier === 'Verizon') return '749';
  return null;
}

function selectedProduct(
  check: PetrockEligibilityCheckKind,
  evidence: Record<string, string | undefined>
) {
  return check === 'carrier_status'
    ? carrierStatusProduct(evidence)
    : HOUSE_CHECK_PRODUCTS[check];
}

async function suppress(
  state: PetrockEligibilitySubmissionState,
  orderId: string,
  reason: string
) {
  await state.suppress({
    message: 'No verified carrier-unlock service is available for this device.',
    orderId,
    reason,
  });
  return { kind: 'suppressed' as const, reason };
}

export async function submitNextPetrockEligibilityCheck({
  client,
  identifier,
  order,
  origin,
  readProduct,
  state,
}: {
  client: Pick<PetrockClient, 'getAccount' | 'submitOrder'>;
  identifier: string;
  order: EligibilityOrder;
  origin: string;
  readProduct: (
    productId: string
  ) => Promise<EligibilityProductSnapshot | null>;
  state: PetrockEligibilitySubmissionState;
}) {
  if (
    getImeiBlacklistState(order.eligibilityEvidence.blacklistStatus) === 'risk'
  ) {
    return suppress(state, order.id, 'blacklist_risk');
  }
  if (!canAssessImeiNetworkUnlock(order.eligibilityEvidence)) {
    return suppress(state, order.id, 'unlock_evidence_required');
  }
  const required = getPetrockEligibilityRequiredChecks(
    order.eligibilityEvidence
  );
  const completed = new Set(order.eligibilityChecksCompleted);
  const unresolvedCompleted = required.find((check) => completed.has(check));
  if (unresolvedCompleted) {
    return suppress(state, order.id, `${unresolvedCompleted}_unknown`);
  }
  const check = required.find((candidate) => !completed.has(candidate));
  if (!check) return { kind: 'ready' as const };

  const productId = selectedProduct(check, order.eligibilityEvidence);
  if (!productId) return suppress(state, order.id, 'carrier_unsupported');
  const product = await readProduct(productId);
  const ageMs = product
    ? Date.now() - Date.parse(product.syncedAt)
    : Number.POSITIVE_INFINITY;
  if (
    !product?.active ||
    product.productId !== productId ||
    product.currency !== 'USD' ||
    !product.orderFieldName ||
    product.priceUsd === null ||
    product.priceUsd <= 0 ||
    product.priceUsd > 1 ||
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    ageMs > 48 * 60 * 60 * 1000
  ) {
    return suppress(state, order.id, 'house_check_unavailable');
  }

  const account = await client.getAccount();
  if (
    !account.ok ||
    account.data.currency !== 'USD' ||
    account.data.balance < product.priceUsd
  ) {
    return suppress(state, order.id, 'provider_balance_unavailable');
  }

  const feedbackToken = randomBytes(32).toString('base64url');
  const referenceId = randomUUID();
  const started = await state.begin({
    check,
    feedbackTokenHash: createHash('sha256').update(feedbackToken).digest('hex'),
    orderId: order.id,
    referenceId,
  });
  if (!started) return { check, kind: 'already_started' as const };

  const submission = await client.submitOrder({
    feedbackUrl: `${origin}/api/webhooks/petrock/remediation/${feedbackToken}`,
    identifier,
    orderFieldName: product.orderFieldName,
    productId,
    referenceId,
  });
  if (!submission.ok) {
    if (!isDefinitivePetrockSubmissionRejection(submission)) {
      await state.markSubmissionUnknown({
        orderId: order.id,
        reason: `eligibility_${submission.kind}`,
      });
      return { check, kind: 'submission_unknown' as const };
    }
    return suppress(state, order.id, 'house_check_rejected');
  }

  try {
    const recorded = await retryPetrockStateWrite(
      () =>
        state.recordSubmission({
          nextPollAt: new Date(Date.now() + 5_000).toISOString(),
          orderId: order.id,
          providerOrderId: submission.data.orderUuid,
          providerStatus: 'new',
        }),
      isRetryablePetrockStateWriteError
    );
    if (!recorded) {
      throw new Error('Accepted eligibility submission transition rejected');
    }
  } catch (error) {
    console.error('[Petrock Eligibility] Accepted order state save failed', {
      error,
      orderId: order.id,
      providerOrderId: submission.data.orderUuid,
    });
    await state.markSubmissionUnknown({
      orderId: order.id,
      providerOrderId: submission.data.orderUuid,
      reason: 'accepted_submission_persistence_failed',
    });
    return { check, kind: 'submission_unknown' as const };
  }
  return { check, kind: 'pending' as const };
}
