import type { ExpoPushTicket } from 'expo-server-sdk';
import { describe, expect, it } from 'vitest';
import { hasUncertainTicketDelivery } from './expo-push-ticket-delivery';

describe('hasUncertainTicketDelivery', () => {
  it('returns false without tickets', () => {
    expect(hasUncertainTicketDelivery([])).toBe(false);
  });

  it('returns false for accepted tickets', () => {
    const tickets = [{ status: 'ok', id: 'ticket-1' }] as ExpoPushTicket[];
    expect(hasUncertainTicketDelivery(tickets)).toBe(false);
  });

  it('returns false for definitive provider rejections', () => {
    const tickets = [
      {
        status: 'error',
        message: 'device gone',
        details: { error: 'DeviceNotRegistered' },
      },
    ] as ExpoPushTicket[];
    expect(hasUncertainTicketDelivery(tickets)).toBe(false);
  });

  it('returns false for error tickets without details', () => {
    const tickets = [{ status: 'error', message: 'nope' }] as ExpoPushTicket[];
    expect(hasUncertainTicketDelivery(tickets)).toBe(false);
  });

  it('returns true when any ticket is a synthesized ExpoError', () => {
    const tickets = [
      { status: 'ok', id: 'ticket-1' },
      {
        status: 'error',
        message: 'network timeout',
        details: { error: 'ExpoError' },
      },
    ] as ExpoPushTicket[];
    expect(hasUncertainTicketDelivery(tickets)).toBe(true);
  });
});
