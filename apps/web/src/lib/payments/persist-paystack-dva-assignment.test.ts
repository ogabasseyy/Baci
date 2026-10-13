import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/types/supabase';
import { persistPaystackDvaAssignment } from './persist-paystack-dva-assignment';

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mockLoggerError },
}));

vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
}));

function createSupabase(
  reservationStatus: string | null = 'inserted',
  error: unknown = null
) {
  const rpc = vi.fn().mockResolvedValue({ data: reservationStatus, error });
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

const assignment = {
  accountName: 'Baci/Ada',
  accountNumber: '0123456789',
  bankName: 'Wema Bank',
  customerEmail: 'ada@example.com',
  orderId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('persistPaystackDvaAssignment', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reserves the account atomically with a 90-minute assignment window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    const { client, rpc } = createSupabase();

    const result = await persistPaystackDvaAssignment(client, assignment);

    expect(result).toBeNull();
    expect(rpc).toHaveBeenCalledWith('reserve_paystack_order_payment_account', {
      p_account_name: 'Baci/Ada',
      p_account_number: '0123456789',
      p_assigned_at: '2026-08-25T12:00:00.000Z',
      p_bank_name: 'Wema Bank',
      p_expires_at: '2026-08-25T13:30:00.000Z',
      p_expected_customer_email: 'ada@example.com',
      p_order_id: assignment.orderId,
      p_provisioning_proof: expect.objectContaining({
        account_name: 'Baci/Ada',
        account_number: '0123456789',
        assigned_at: '2026-08-25T12:00:00.000Z',
        bank_name: 'Wema Bank',
        customer_email: 'ada@example.com',
        expires_at: '2026-08-25T13:30:00.000Z',
        order_id: assignment.orderId,
        scope: 'paystack_dva_reservation',
        version: 'paystack-dva-reservation:v1',
        signature: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
  });

  it('accepts an existing active assignment without replacing its lower bound', async () => {
    const { client } = createSupabase('existing');

    await expect(
      persistPaystackDvaAssignment(client, assignment)
    ).resolves.toBeNull();
  });

  it('uses an explicit invoice due date when supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    const { client, rpc } = createSupabase();

    await persistPaystackDvaAssignment(client, {
      ...assignment,
      expiresAt: '2026-09-08T12:00:00.000Z',
    });

    expect(rpc).toHaveBeenCalledWith(
      'reserve_paystack_order_payment_account',
      expect.objectContaining({
        p_expires_at: '2026-09-08T12:00:00.000Z',
      })
    );
  });

  it('returns a retryable error response when reservation fails', async () => {
    const databaseError = { message: 'write failed' };
    const { client } = createSupabase(null, databaseError);

    const result = await persistPaystackDvaAssignment(client, assignment);

    expect(result?.status).toBe(503);
    expect(await result?.json()).toEqual({
      code: 'DVA_PERSISTENCE_FAILED',
      error:
        'Unable to reserve a bank account for this order. Please try again.',
    });
    expect(mockLoggerError).toHaveBeenCalledWith({
      error: databaseError,
      message: 'Failed to persist Paystack DVA assignment',
      orderId: assignment.orderId,
      reservationStatus: null,
    });
  });

  it('fails closed when the locked order became ineligible', async () => {
    const { client } = createSupabase('ineligible');

    const result = await persistPaystackDvaAssignment(client, assignment);

    expect(result?.status).toBe(503);
    expect(await result?.json()).toMatchObject({
      code: 'DVA_PERSISTENCE_FAILED',
    });
  });
});
