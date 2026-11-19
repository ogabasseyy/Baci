import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ImeiCheckField, ImeiDeviceCategory } from '@baci/shared/imei';
import { NextResponse } from 'next/server';
import type { ImeiRpcClient } from '@/lib/imei-access';
import { encryptImeiIdentifier } from '@/lib/imei-identifier-crypto';
import { redeemImeiWalletAndBeginProviderSubmission } from '@/lib/imei-lookup-fulfillment';
import { PETROCK_DEFAULT_POLL_AFTER_MS } from '@/lib/imei-providers/petrock/petrock.constants';
import {
  finalizePetrockLookup,
  markPetrockSubmissionUnknown,
  recordPetrockSubmission,
} from '@/lib/imei-providers/petrock/petrock-lookup-state';
import {
  isRetryablePetrockStateWriteError,
  retryPetrockStateWrite,
} from '@/lib/imei-providers/petrock/retry-petrock-state-write';
import type {
  ImeiProvider,
  ImeiProviderBinding,
  ImeiProviderOutcome,
} from '@/lib/imei-providers/types';

type AdminClient = ImeiRpcClient;

export function pendingPetrockResponse(lookupId: string) {
  return NextResponse.json(
    {
      lookupId,
      pollAfterMs: PETROCK_DEFAULT_POLL_AFTER_MS,
      status: 'pending',
      success: true,
    },
    { status: 202 }
  );
}

async function persistUnknown(
  lookupId: string,
  providerStatus: string,
  supabaseAdmin: AdminClient,
  providerOrderId?: string
) {
  try {
    await markPetrockSubmissionUnknown({
      lookupId,
      providerOrderId,
      providerStatus,
      supabaseAdmin,
    });
  } catch (error) {
    console.error('[Petrock IMEI] Failed to persist submission_unknown', {
      error,
      lookupId,
      providerStatus,
    });
  }
}

export async function submitPetrockLookup({
  amount,
  binding,
  checksIncluded,
  customerId,
  deviceCategory,
  encryptionKey,
  identifier,
  lookupId,
  merchantId,
  onDebitSucceeded,
  origin,
  provider,
  supabaseAdmin,
  tierName,
}: {
  amount: number;
  binding: ImeiProviderBinding;
  checksIncluded: readonly ImeiCheckField[];
  customerId: string;
  deviceCategory?: ImeiDeviceCategory;
  encryptionKey: string;
  identifier: string;
  lookupId: string;
  merchantId: string;
  onDebitSucceeded?: () => void;
  origin: string;
  provider: Pick<ImeiProvider, 'submit'>;
  supabaseAdmin: AdminClient;
  tierName: string;
}) {
  const feedbackToken = randomBytes(32).toString('base64url');
  const feedbackTokenHash = createHash('sha256')
    .update(feedbackToken)
    .digest('hex');
  const referenceId = randomUUID();
  const startedAt = new Date();

  await redeemImeiWalletAndBeginProviderSubmission({
    amount,
    costUsd: binding.costUsd,
    customerId,
    deviceCategory,
    feedbackTokenHash,
    identifierCiphertext: encryptImeiIdentifier(identifier, encryptionKey),
    lookupId,
    merchantId,
    providerAttemptStartedAt: startedAt.toISOString(),
    referenceId,
    supabaseAdmin,
  });
  onDebitSucceeded?.();

  let outcome: ImeiProviderOutcome;
  try {
    outcome = await provider.submit({
      binding,
      checksIncluded,
      feedbackUrl: `${origin}/api/webhooks/petrock/imei/${feedbackToken}`,
      identifier,
      referenceId,
      tierName,
    });
  } catch (error) {
    console.error('[Petrock IMEI] Unexpected submission error', {
      error,
      lookupId,
    });
    await persistUnknown(lookupId, 'submit_unexpected_error', supabaseAdmin);
    return pendingPetrockResponse(lookupId);
  }

  if (outcome.kind === 'pending') {
    const nextPollAt = new Date(
      Date.now() + PETROCK_DEFAULT_POLL_AFTER_MS
    ).toISOString();
    try {
      const recorded = await retryPetrockStateWrite(
        () =>
          recordPetrockSubmission({
            lookupId,
            nextPollAt,
            orderId: outcome.providerOrderId,
            providerStatus: outcome.providerStatus,
            supabaseAdmin,
          }),
        isRetryablePetrockStateWriteError
      );
      if (!recorded) throw new Error('Accepted order transition was rejected');
    } catch (error) {
      console.error('[Petrock IMEI] Accepted order state save failed', {
        error,
        lookupId,
        providerOrderId: outcome.providerOrderId,
      });
      await persistUnknown(
        lookupId,
        'accepted_order_save_failed',
        supabaseAdmin,
        outcome.providerOrderId
      );
    }
    return pendingPetrockResponse(lookupId);
  }

  if (outcome.kind === 'submission_unknown') {
    await persistUnknown(lookupId, outcome.providerStatus, supabaseAdmin);
    console.error('[Petrock IMEI] Submission outcome is unknown', {
      lookupId,
      reason: outcome.reason,
    });
    return pendingPetrockResponse(lookupId);
  }

  const body =
    outcome.kind === 'complete'
      ? { ...outcome.body, status: 'complete' as const }
      : { ...outcome.body, status: 'error' as const };
  const terminalStatus =
    outcome.kind === 'complete'
      ? 'completed'
      : outcome.refundReason === 'not_found'
        ? 'refunded_not_found'
        : 'refunded_error';
  try {
    const finalized = await retryPetrockStateWrite(
      () =>
        finalizePetrockLookup({
          body,
          lookupId,
          providerStatus: outcome.providerStatus,
          responseHash: outcome.rawResponseText
            ? createHash('sha256').update(outcome.rawResponseText).digest('hex')
            : undefined,
          status: outcome.status,
          supabaseAdmin,
          terminalStatus,
        }),
      isRetryablePetrockStateWriteError
    );
    if (!finalized) return pendingPetrockResponse(lookupId);
  } catch (error) {
    console.error('[Petrock IMEI] Terminal state save failed', {
      error,
      lookupId,
    });
    return pendingPetrockResponse(lookupId);
  }

  return NextResponse.json(body, { status: outcome.status });
}
