import type { ExpoPushTicket } from 'expo-server-sdk';

// expo-push-chunk-delivery synthesizes ExpoError tickets when a provider
// request throws without a definitive response; delivery may still have
// happened, so callers must treat the outcome as unknown rather than failed.
export function hasUncertainTicketDelivery(tickets: ExpoPushTicket[]): boolean {
  return tickets.some(
    (ticket) =>
      ticket.status === 'error' && ticket.details?.error === 'ExpoError'
  );
}
