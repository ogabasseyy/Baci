import type { ClaimedSavingsNotification } from '@/schemas/savings-notification-worker';

export type SavingsPushOutcome = 'accepted' | 'rejected' | 'unknown';

export type SavingsPushResult = {
  outcome: SavingsPushOutcome;
  ticketId: string | null;
};

export type SavingsPushInput = {
  token: string;
  title: string;
  body: string;
  data: {
    type: 'savings';
    goalId: string;
    notificationId: string;
    merchantId: string;
  };
  channelId: 'savings';
  accessToken?: string;
};

type FinishPushInput = {
  notificationId: string;
  pushToken: string;
  claimId: string;
  outcome: SavingsPushOutcome;
  ticketId: string | null;
};

type PushWorkerDependencies = {
  send: (input: SavingsPushInput) => Promise<SavingsPushResult>;
  finishPush: (input: FinishPushInput) => Promise<boolean>;
  accessToken?: string;
};

export type SavingsPushWorkerCounts = {
  accepted: number;
  rejected: number;
  unknown: number;
  finishFailed: number;
};

export const SAVINGS_NOTIFICATION_PUSH_CONCURRENCY = 6;

export async function processSavingsNotificationPushClaims(
  claims: ClaimedSavingsNotification[],
  dependencies: PushWorkerDependencies,
  options: { concurrency?: number } = {}
): Promise<SavingsPushWorkerCounts> {
  const concurrency = options.concurrency ?? 1;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > SAVINGS_NOTIFICATION_PUSH_CONCURRENCY
  ) {
    throw new Error('Invalid savings notification push concurrency');
  }

  const counts: SavingsPushWorkerCounts = {
    accepted: 0,
    rejected: 0,
    unknown: 0,
    finishFailed: 0,
  };

  const processClaim = async (
    claim: ClaimedSavingsNotification
  ): Promise<SavingsPushOutcome | 'finishFailed'> => {
    let result: SavingsPushResult;
    try {
      result = await dependencies.send({
        token: claim.push_token,
        title: claim.title,
        body: claim.body,
        data: {
          type: 'savings',
          goalId: claim.data.goalId,
          notificationId: claim.notification_id,
          merchantId: claim.data.merchantId,
        },
        channelId: 'savings',
        accessToken: dependencies.accessToken,
      });
    } catch {
      result = { outcome: 'unknown', ticketId: null };
    }

    const finished = await dependencies.finishPush({
      notificationId: claim.notification_id,
      pushToken: claim.push_token,
      claimId: claim.claim_id,
      outcome: result.outcome,
      ticketId: result.ticketId,
    });
    return finished ? result.outcome : 'finishFailed';
  };

  for (let offset = 0; offset < claims.length; offset += concurrency) {
    const batch = claims.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(batch.map(processClaim));
    for (const result of results) {
      if (result.status === 'rejected') {
        throw new Error('Failed to finish savings notification push claim');
      }
      counts[result.value] += 1;
    }
  }

  return counts;
}
