import Expo, {
  type ExpoPushMessage,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import { createDeliveryStartBoundary } from '@/lib/push-delivery-boundary';

export type DeliveryStartOptions = {
  onDeliveryStart?: () => void | Promise<void>;
  onDeliveryRejected?: () => void | Promise<void>;
  requiredShipmentUpdateCapability?: number;
};

export interface PushChunkDelivery {
  tickets: ExpoPushTicket[];
  /**
   * True when a provider request threw without a definitive response:
   * delivery may still have happened, so callers must treat the
   * outcome as unknown rather than failed. Carried explicitly —
   * Expo's own `ExpoError` tickets are definitive rejections and must
   * not be inferred as uncertain from their public error code.
   */
  deliveryUncertain: boolean;
}

export async function sendPushNotificationChunks(
  expo: Expo,
  messages: ExpoPushMessage[],
  options?: DeliveryStartOptions
): Promise<PushChunkDelivery> {
  if (messages.length === 0) return { deliveryUncertain: false, tickets: [] };

  const validMessages: ExpoPushMessage[] = [];
  const resultMap: { index: number; ticket?: ExpoPushTicket }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const tokens = Array.isArray(msg.to) ? msg.to : [msg.to];
    const allValid = tokens.every((token) => Expo.isExpoPushToken(token));

    if (allValid) {
      resultMap.push({ index: i });
      validMessages.push(msg);
    } else {
      const invalidToken = tokens.find((token) => !Expo.isExpoPushToken(token));
      resultMap.push({
        index: i,
        ticket: {
          status: 'error',
          message: `Invalid Expo push token: ${invalidToken}`,
          details: { error: 'DeviceNotRegistered' },
        },
      });
    }
  }

  if (validMessages.length === 0) {
    // Locally rejected tokens never reached the provider: definitive.
    return {
      deliveryUncertain: false,
      tickets: resultMap.map((entry) => entry.ticket as ExpoPushTicket),
    };
  }

  const chunks = expo.chunkPushNotifications(validMessages);
  const sdkTickets: ExpoPushTicket[] = [];
  const { markDeliveryStarted } = createDeliveryStartBoundary(
    options?.onDeliveryStart
  );
  let allProviderResponsesDefinitive = true;

  for (const chunk of chunks) {
    await markDeliveryStarted();

    let chunkTickets: ExpoPushTicket[];
    try {
      chunkTickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      if (isMixedProjectPushError(error)) {
        console.warn(
          '[expo-push] Mixed-project token batch detected, retrying chunk per message'
        );
        const fallbackResult = await sendChunkIndividually(
          expo,
          chunk,
          markDeliveryStarted
        );
        sdkTickets.push(...fallbackResult.tickets);
        allProviderResponsesDefinitive &&=
          fallbackResult.allProviderResponsesDefinitive;
        continue;
      }

      allProviderResponsesDefinitive = false;
      for (const _ of chunk) {
        // The `ExpoError` code keeps token handling report-only (never
        // deactivates); uncertainty itself travels on
        // `deliveryUncertain`, never inferred from this public code.
        sdkTickets.push({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: { error: 'ExpoError' },
        });
      }
      continue;
    }

    sdkTickets.push(...chunkTickets);
  }

  if (
    options?.onDeliveryRejected &&
    allProviderResponsesDefinitive &&
    sdkTickets.length === validMessages.length &&
    sdkTickets.every((ticket) => ticket.status === 'error')
  ) {
    await options.onDeliveryRejected();
  }

  let sdkIndex = 0;
  return {
    deliveryUncertain: !allProviderResponsesDefinitive,
    tickets: resultMap.map((entry) => {
      if (entry.ticket) return entry.ticket;
      return sdkTickets[sdkIndex++];
    }),
  };
}

function isMixedProjectPushError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return message.includes('same request must be for the same project');
}

async function sendChunkIndividually(
  expo: Expo,
  chunk: ExpoPushMessage[],
  markDeliveryStarted: () => Promise<void>
): Promise<{
  tickets: ExpoPushTicket[];
  allProviderResponsesDefinitive: boolean;
}> {
  const tickets: ExpoPushTicket[] = [];
  let allProviderResponsesDefinitive = true;

  for (const message of chunk) {
    await markDeliveryStarted();
    try {
      const [ticket] = await expo.sendPushNotificationsAsync([message]);
      tickets.push(ticket);
    } catch (error) {
      allProviderResponsesDefinitive = false;
      // See the chunk-level catch above: the code stays report-only
      // for token handling; uncertainty travels on the return flag.
      tickets.push({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: { error: 'ExpoError' },
      });
    }
  }

  return { tickets, allProviderResponsesDefinitive };
}
