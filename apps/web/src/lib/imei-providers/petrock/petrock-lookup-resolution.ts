import { enrichImeiDeviceResult } from '@/lib/imei-device-catalog';
import 'server-only';

import { createHash } from 'node:crypto';
import { IMEI_SERVICE_TIERS } from '@baci/shared/imei';
import type { ImeiRpcClient } from '@/lib/imei-access';
import { decryptImeiIdentifier } from '@/lib/imei-identifier-crypto';
import type { ImeiProvider } from '../types';
import {
  PETROCK_MAX_POLL_AFTER_MS,
  PETROCK_SUBMISSION_MANUAL_REVIEW_ATTEMPTS,
} from './petrock.constants';
import type { ClaimedPetrockPoll } from './petrock-lookup-state';
import {
  finalizePetrockLookup,
  reschedulePetrockLookupPoll,
} from './petrock-lookup-state';

type AdminClient = ImeiRpcClient;
type PollProvider = {
  poll: NonNullable<ImeiProvider['poll']>;
};

function pollDelayMs(attempt: number) {
  if (attempt <= 3) return 5_000;
  if (attempt <= 10) return 30_000;
  return PETROCK_MAX_POLL_AFTER_MS;
}

export async function resolveClaimedPetrockLookup({
  attempt = 1,
  encryptionKey,
  merchantId,
  lookup,
  provider,
  supabaseAdmin,
}: {
  attempt?: number;
  encryptionKey: string;
  merchantId: string;
  lookup: ClaimedPetrockPoll;
  provider: PollProvider;
  supabaseAdmin: AdminClient;
}) {
  if (!lookup.provider_order_id || !lookup.identifier_ciphertext) {
    const pollAfterMs = PETROCK_MAX_POLL_AFTER_MS;
    const rescheduled = await reschedulePetrockLookupPoll({
      leaseToken: lookup.lease_token,
      lookupId: lookup.id,
      nextPollAt: new Date(Date.now() + pollAfterMs).toISOString(),
      providerStatus:
        lookup.status === 'submission_unknown' && !lookup.provider_order_id
          ? 'submission_unknown_manual_review'
          : 'poll_identity_missing',
      supabaseAdmin,
    });
    if (!rescheduled) return { kind: 'lease_lost' as const, pollAfterMs };
    return {
      kind: 'pending' as const,
      pollAfterMs,
      needsReview:
        lookup.status === 'submission_unknown' &&
        !lookup.provider_order_id &&
        attempt >= PETROCK_SUBMISSION_MANUAL_REVIEW_ATTEMPTS,
    };
  }

  const tier = IMEI_SERVICE_TIERS[lookup.tier];
  const outcome = await provider.poll({
    checksIncluded: tier.checksIncluded,
    identifier: decryptImeiIdentifier(
      lookup.identifier_ciphertext,
      encryptionKey
    ),
    providerOrderId: lookup.provider_order_id,
    tierName: tier.name,
  });

  if (outcome.kind === 'pending' || outcome.kind === 'submission_unknown') {
    const pollAfterMs = pollDelayMs(attempt);
    const rescheduled = await reschedulePetrockLookupPoll({
      leaseToken: lookup.lease_token,
      lookupId: lookup.id,
      nextPollAt: new Date(Date.now() + pollAfterMs).toISOString(),
      providerStatus: outcome.providerStatus,
      supabaseAdmin,
    });
    if (!rescheduled) return { kind: 'lease_lost' as const, pollAfterMs };
    return { kind: 'pending' as const, pollAfterMs };
  }

  const body =
    outcome.kind === 'complete'
      ? {
          ...outcome.body,
          data: await enrichImeiDeviceResult(merchantId, outcome.body.data),
          lookupId: lookup.id,
          status: 'complete' as const,
        }
      : {
          ...outcome.body,
          lookupId: lookup.id,
          status: 'error' as const,
        };
  const terminalStatus =
    outcome.kind === 'complete'
      ? 'completed'
      : outcome.refundReason === 'not_found'
        ? 'refunded_not_found'
        : 'refunded_error';
  const finalized = await finalizePetrockLookup({
    body,
    leaseToken: lookup.lease_token,
    lookupId: lookup.id,
    providerStatus: outcome.providerStatus,
    responseHash: outcome.rawResponseText
      ? createHash('sha256').update(outcome.rawResponseText).digest('hex')
      : undefined,
    status: outcome.status,
    supabaseAdmin,
    terminalStatus,
  });
  if (!finalized) {
    return { kind: 'lease_lost' as const, pollAfterMs: pollDelayMs(attempt) };
  }

  return {
    body,
    kind: outcome.kind,
    status: outcome.status,
  };
}
