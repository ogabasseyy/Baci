import { describe, expect, it } from 'vitest';
import { createPaystackDvaReservationProof } from './paystack-dva-reservation-proof';

const input = {
  accountName: ' Baci / Ada ',
  accountNumber: ' 0123456789 ',
  assignedAt: '2026-08-25T12:00:00+00:00',
  bankName: ' Wema Bank ',
  customerEmail: ' Ada@Example.com ',
  expiresAt: '2026-08-25T13:30:00+00:00',
  orderId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('createPaystackDvaReservationProof', () => {
  it('normalizes assignment metadata before signing it', () => {
    const proof = createPaystackDvaReservationProof(input, {
      issuedAt: '2026-08-25T12:00:01+00:00',
      secret: 'reservation-secret',
    });

    expect(proof).toMatchObject({
      account_name: 'Baci / Ada',
      account_number: '0123456789',
      assigned_at: '2026-08-25T12:00:00.000Z',
      bank_name: 'Wema Bank',
      customer_email: 'ada@example.com',
      expires_at: '2026-08-25T13:30:00.000Z',
      issued_at: '2026-08-25T12:00:01.000Z',
      order_id: input.orderId,
      scope: 'paystack_dva_reservation',
      version: 'paystack-dva-reservation:v1',
    });
    expect(proof.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the signature when a signed reservation field changes', () => {
    const first = createPaystackDvaReservationProof(input, {
      issuedAt: '2026-08-25T12:00:01Z',
      secret: 'reservation-secret',
    });
    const second = createPaystackDvaReservationProof(
      { ...input, accountNumber: '9876543210' },
      {
        issuedAt: '2026-08-25T12:00:01Z',
        secret: 'reservation-secret',
      }
    );

    expect(second.signature).not.toBe(first.signature);
  });

  it('rejects malformed assignment timestamps', () => {
    expect(() =>
      createPaystackDvaReservationProof(
        { ...input, expiresAt: 'not-a-timestamp' },
        { secret: 'reservation-secret' }
      )
    ).toThrow('Invalid Paystack DVA reservation expires_at');
  });

  it('fails closed when a signing secret is missing', () => {
    expect(() => createPaystackDvaReservationProof(input)).toThrow(
      'Paystack DVA reservation secret is not configured'
    );
  });
});
