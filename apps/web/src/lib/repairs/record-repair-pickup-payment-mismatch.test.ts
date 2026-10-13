import { describe, expect, it, vi } from 'vitest';
import {
  readRepairPickupMismatchIdentity,
  recordRepairPickupPaymentMismatch,
} from './record-repair-pickup-payment-mismatch';

describe('recordRepairPickupPaymentMismatch', () => {
  it('reads unsigned merchant and repair ids from metadata', () => {
    expect(
      readRepairPickupMismatchIdentity({
        merchant_id: '123e4567-e89b-12d3-a456-426614174000',
        repair_id: '223e4567-e89b-12d3-a456-426614174000',
      })
    ).toEqual({
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      repairId: '223e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('returns false when merchant identity is unavailable', async () => {
    const rpc = vi.fn();
    const recorded = await recordRepairPickupPaymentMismatch({
      currency: 'NGN',
      gatewayResponse: {},
      merchantId: null,
      mismatchReason: 'claim_missing_or_invalid',
      reference: 'RPU-ABC123DEF45678',
      repairId: null,
      supabase: { rpc } as never,
      verifiedAmount: 8250,
    });

    expect(recorded).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns true when the mismatch RPC records or idempotently replays', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ recorded: true }],
      error: null,
    });

    const recorded = await recordRepairPickupPaymentMismatch({
      currency: 'NGN',
      gatewayResponse: { currency: 'NGN' },
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      mismatchReason: 'amount_mismatch',
      reference: 'RPU-ABC123DEF45678',
      repairId: '223e4567-e89b-12d3-a456-426614174000',
      supabase: { rpc } as never,
      verifiedAmount: 8000,
    });

    expect(recorded).toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_repair_pickup_payment_mismatch', {
      p_amount: 8000,
      p_currency: 'NGN',
      p_gateway_response: { currency: 'NGN' },
      p_merchant_id: '123e4567-e89b-12d3-a456-426614174000',
      p_mismatch_reason: 'amount_mismatch',
      p_reference: 'RPU-ABC123DEF45678',
      p_repair_id: '223e4567-e89b-12d3-a456-426614174000',
    });
  });

  it('returns false when mismatch persistence fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'offline' },
    });

    const recorded = await recordRepairPickupPaymentMismatch({
      currency: 'NGN',
      gatewayResponse: {},
      merchantId: '123e4567-e89b-12d3-a456-426614174000',
      mismatchReason: 'claim_missing_or_invalid',
      reference: 'RPU-ABC123DEF45678',
      repairId: null,
      supabase: { rpc } as never,
      verifiedAmount: 8250,
    });

    expect(recorded).toBe(false);
  });
});
