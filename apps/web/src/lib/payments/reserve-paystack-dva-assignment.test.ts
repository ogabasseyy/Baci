import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { reservePaystackDvaAssignment } from './reserve-paystack-dva-assignment';

const { mockCreateProof } = vi.hoisted(() => ({
  mockCreateProof: vi.fn((payload: Record<string, unknown>) => ({
    ...payload,
    signature: 'a'.repeat(64),
    scope: 'paystack_dva_reservation',
    version: 'paystack-dva-reservation:v1',
  })),
}));

vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('@/lib/payments/paystack-dva-reservation-proof', () => ({
  createPaystackDvaReservationProof: mockCreateProof,
}));

const assignment = {
  accountName: 'Baci/Ada',
  accountNumber: '0123456789',
  bankName: 'Wema Bank',
  customerEmail: 'ada@example.com',
  orderId: '550e8400-e29b-41d4-a716-446655440000',
};

function createSupabase() {
  const rpc = vi.fn().mockResolvedValue({ data: 'inserted', error: null });
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

describe('reservePaystackDvaAssignment', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('creates a signed reservation with a 90-minute default window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    const { client, rpc } = createSupabase();

    const result = await reservePaystackDvaAssignment(client, assignment);

    expect(result).toEqual({ data: 'inserted', error: null });
    expect(rpc).toHaveBeenCalledWith(
      'reserve_paystack_order_payment_account',
      expect.objectContaining({
        p_assigned_at: '2026-08-25T12:00:00.000Z',
        p_expires_at: '2026-08-25T13:30:00.000Z',
        p_expected_customer_email: assignment.customerEmail,
        p_order_id: assignment.orderId,
        p_provisioning_proof: expect.objectContaining({
          accountName: assignment.accountName,
          accountNumber: assignment.accountNumber,
          signature: 'a'.repeat(64),
        }),
      })
    );
    expect(mockCreateProof).toHaveBeenCalledTimes(1);
  });

  it('returns a proof error without calling the reservation RPC', async () => {
    mockCreateProof.mockImplementationOnce(() => {
      throw new Error('missing signing secret');
    });
    const { client, rpc } = createSupabase();

    const result = await reservePaystackDvaAssignment(client, assignment);

    expect(result).toMatchObject({
      data: null,
      error: null,
      proofError: 'missing signing secret',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
