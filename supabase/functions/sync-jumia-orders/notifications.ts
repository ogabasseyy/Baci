const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendJumiaPushNotification(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        to: token,
        title,
        body,
        data,
        sound: 'default',
        channelId: 'orders',
        priority: 'high',
      },
    ]),
  });
}

export function formatJumiaAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN',
    minimumFractionDigits: 0,
  }).format(amount);
}

export function getSuccessfullyNotifiedJumiaOrderIds(
  notifiedOrderIds: string[],
  pushResults: PromiseSettledResult<void>[],
  tokenCount: number
): string[] {
  const failedPushIndices = new Set<number>();
  for (let i = 0; i < pushResults.length; i++) {
    if (pushResults[i].status === 'rejected') {
      failedPushIndices.add(i);
    }
  }

  return notifiedOrderIds.filter((_, orderIdx) => {
    for (let tokenIdx = 0; tokenIdx < tokenCount; tokenIdx++) {
      const promiseIdx = orderIdx * tokenCount + tokenIdx;
      if (!failedPushIndices.has(promiseIdx)) return true;
    }
    return false;
  });
}
