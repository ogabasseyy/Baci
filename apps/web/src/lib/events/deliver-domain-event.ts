import { deliverAnalyticsEvent } from './analytics-destination-adapter';
import { deliverChatgptPaidOrder } from './chatgpt-destination-adapter';
import type {
  EventDestinationAdapter,
  EventDestinationContext,
} from './event-destination';
import { deliverPlatformEvent } from './platform-destination-adapter';

const REQUEST_TIMEOUT_MS = 10_000;

const adapter: EventDestinationAdapter = {
  async deliver(context) {
    if (context.destination === 'chatgpt')
      return deliverChatgptPaidOrder(
        context.supabase,
        context.event,
        context.signal
      );
    if (context.event.event_name.startsWith('analytics.')) {
      return await deliverAnalyticsEvent(
        context.supabase,
        context.event,
        context.destination,
        context.signal
      );
    }
    if (context.event.event_name.startsWith('platform.')) {
      return await deliverPlatformEvent(
        context.supabase,
        context.event,
        context.destination,
        context.signal
      );
    }
    return {
      errorCode: 'unsupported_event',
      errorMessage: 'No destination adapter for this event domain',
      success: false,
    };
  },
};

export async function deliverDomainEvent(
  context: Omit<EventDestinationContext, 'signal'>
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      adapter.deliver({ ...context, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort(new Error('provider_request_timeout'));
          reject(new Error('provider_request_timeout'));
        }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unhandled_error';
    return {
      errorCode: message,
      errorMessage: message,
      requestMayHaveBeenSent: message === 'provider_request_timeout',
      success: false,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
