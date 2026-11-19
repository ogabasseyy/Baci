import { vi } from 'vitest';
import type { PendingTransactionMockOptions } from './vtu-fulfillment.test-support-types';

type PendingTransactionUpdateErrors = NonNullable<
  PendingTransactionMockOptions['updateErrors']
>;
type PendingTransactionUpdateError =
  PendingTransactionUpdateErrors[keyof PendingTransactionUpdateErrors];

function selectUpdateError(
  payloadRecord: Record<string, unknown>,
  transactionRow: Record<string, unknown>,
  updateErrors: NonNullable<PendingTransactionMockOptions['updateErrors']>
): PendingTransactionUpdateError {
  if (
    payloadRecord.status === 'successful' ||
    payloadRecord.status === 'failed'
  ) {
    return updateErrors.purchase;
  }

  if (transactionRow.status === 'successful') {
    return updateErrors.successMetadata;
  }

  return updateErrors.finalMetadata;
}

function isSubmissionMarkerShaped(payloadRecord: Record<string, unknown>) {
  const markerMetadata =
    payloadRecord.metadata && typeof payloadRecord.metadata === 'object'
      ? (payloadRecord.metadata as Record<string, unknown>)
      : null;
  return (
    !('status' in payloadRecord) &&
    !('transaction_id' in payloadRecord) &&
    !('error_message' in payloadRecord) &&
    markerMetadata !== null &&
    'providerSubmissionStartedAt' in markerMetadata
  );
}

function isClaimOrErrorUpdate(payloadRecord: Record<string, unknown>): boolean {
  return (
    payloadRecord.status === 'processing' ||
    ('error_message' in payloadRecord && !('metadata' in payloadRecord))
  );
}

function createAwaitableUpdateChain<T>(
  result: T,
  maybeSingle: ReturnType<typeof vi.fn>
) {
  const chain = Promise.resolve(result) as Promise<T> & {
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.maybeSingle = maybeSingle;
  chain.select = vi.fn(() => chain);
  return chain;
}

/**
 * The vtu_transactions update() stand-in: routes each payload to the claim,
 * notification, retry, restore or purchase chain the code under test expects.
 */
export function createVtuTransactionUpdateMock({
  claimMaybeSingle,
  notificationClaimMaybeSingle,
  options,
  transactionRow,
}: {
  claimMaybeSingle: ReturnType<typeof vi.fn>;
  notificationClaimMaybeSingle: ReturnType<typeof vi.fn>;
  options: PendingTransactionMockOptions;
  transactionRow: Record<string, unknown>;
}) {
  const {
    expectedRestoreToken,
    fallbackMarkerData,
    purchaseUpdateData = { id: 'vtu-1' },
    purchaseUpdateErrors,
    updateErrors = {},
    updatePayloads = [],
  } = options;
  let purchaseUpdateAttempt = 0;
  // The first marker-shaped write always takes the submissionMarker
  // slot (unscripted → success: the normal pre-vend marker). Later
  // ones take it only while a scripted error stands AND the write is
  // non-terminal: the marker write retries (R79: 3 attempts), so
  // failing only the first would let the retry succeed and the test
  // would vend instead of restoring. Terminal (post-vend)
  // marker-shaped writes and unscripted runs fall through to
  // finalMetadata, preserving tests that script a failure for a
  // post-vend metadata write.
  let submissionMarkerWriteSeen = false;

  return vi.fn((payload: unknown) => {
    updatePayloads.push(payload);
    const payloadRecord =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    const metadataPayload =
      payloadRecord.metadata && typeof payloadRecord.metadata === 'object'
        ? (payloadRecord.metadata as Record<string, unknown>)
        : null;
    const isNotificationClaim =
      metadataPayload?.customerNotificationAttempted === true &&
      !('customerNotificationSent' in metadataPayload) &&
      !('paymentPending' in metadataPayload) &&
      !('status' in payloadRecord);
    const isRetryReconciliation =
      payloadRecord.status === 'successful' &&
      payloadRecord.error_message === null &&
      !('metadata' in payloadRecord) &&
      !('transaction_id' in payloadRecord);

    if (isNotificationClaim) {
      const notificationClaimChain = {
        eq: vi.fn(() => notificationClaimChain),
        maybeSingle: notificationClaimMaybeSingle,
        or: vi.fn(() => notificationClaimChain),
        select: vi.fn(() => notificationClaimChain),
      };
      return notificationClaimChain;
    }

    if (isRetryReconciliation) {
      const retryReconciliationChain = {
        eq: vi.fn(() => retryReconciliationChain),
        maybeSingle: claimMaybeSingle,
        select: vi.fn(() => retryReconciliationChain),
      };
      return retryReconciliationChain;
    }

    if (!isClaimOrErrorUpdate(payloadRecord)) {
      if (
        expectedRestoreToken !== undefined &&
        payloadRecord.status === 'pending' &&
        typeof metadataPayload?.preVendInterruptedAt === 'string'
      ) {
        // Token-gated pre-vend restore: captures the CAS
        // token from the eq chain and matches only on the
        // expected value (Codex R65 6ru4mQ).
        let capturedToken: unknown;
        const restoreChain = createAwaitableUpdateChain(
          { data: null, error: null },
          vi.fn()
        );
        restoreChain.eq = vi.fn((column: string, value: unknown) => {
          if (column === 'updated_at') {
            capturedToken = value;
          }
          return restoreChain;
        });
        restoreChain.maybeSingle = vi.fn().mockImplementation(() =>
          Promise.resolve({
            data:
              capturedToken === expectedRestoreToken ? { id: 'vtu-1' } : null,
            error: null,
          })
        );
        return restoreChain;
      }
      let updateError = selectUpdateError(
        payloadRecord,
        transactionRow,
        updateErrors
      );
      if (isSubmissionMarkerShaped(payloadRecord)) {
        const terminalWrite =
          payloadRecord.status === 'successful' ||
          payloadRecord.status === 'failed';
        if (
          !submissionMarkerWriteSeen ||
          (updateErrors.submissionMarker !== undefined && !terminalWrite)
        ) {
          updateError = updateErrors.submissionMarker;
        }
        submissionMarkerWriteSeen = true;
      }
      if (
        (payloadRecord.status === 'successful' ||
          payloadRecord.status === 'failed') &&
        purchaseUpdateErrors &&
        purchaseUpdateErrors.length > 0
      ) {
        const errorIndex = Math.min(
          purchaseUpdateAttempt,
          purchaseUpdateErrors.length - 1
        );
        updateError = purchaseUpdateErrors[errorIndex] ?? undefined;
        purchaseUpdateAttempt += 1;
      }

      const isFallbackMarker =
        !('status' in payloadRecord) &&
        metadataPayload?.providerFallback === 'monnify_airtime_to_kuda';
      const purchaseUpdateMaybeSingle = vi.fn().mockResolvedValue({
        data: updateError
          ? null
          : isFallbackMarker && fallbackMarkerData !== undefined
            ? fallbackMarkerData
            : purchaseUpdateData,
        error: updateError ?? null,
      });
      return createAwaitableUpdateChain(
        {
          data: null,
          error: updateError ?? null,
        },
        purchaseUpdateMaybeSingle
      );
    }

    return createAwaitableUpdateChain(
      { data: null, error: null },
      claimMaybeSingle
    );
  });
}
