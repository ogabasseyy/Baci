import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairBookingInput } from '@/lib/validations/repair';
import { createRepairBooking } from './create-repair-core';

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  return {
    cookies: vi.fn(),
    createClient: vi.fn(() => ({ rpc })),
    ensureActionRateLimit: vi.fn(),
    rpc,
  };
});

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.ensureActionRateLimit,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const quoteId = '223e4567-e89b-12d3-a456-426614174999';

const validInput: RepairBookingInput = {
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  customerPhone: '08012345678',
  deviceType: 'Smartphone',
  deviceModel: 'iPhone 15',
  issueDescription: 'The screen is cracked and the battery drains quickly.',
  preferredDate: '2026-06-03',
  serviceType: 'dropoff',
};

describe('createRepairBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureActionRateLimit.mockResolvedValue(true);
    mocks.cookies.mockResolvedValue({ get: vi.fn() });
    mocks.rpc.mockResolvedValue({
      data: [{ id: 'repair-1', ticket_number: 42 }],
      error: null,
    });
  });

  it('books through the RPC and returns the id and ticket number', async () => {
    const result = await createRepairBooking(
      { ...validInput, quoteId },
      merchantId
    );

    expect(result).toEqual({ success: true, id: 'repair-1', ticketNumber: 42 });
    expect(mocks.ensureActionRateLimit).toHaveBeenCalledWith('repair-create', {
      requests: 5,
      windowMs: 60_000,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_repair_booking',
      expect.objectContaining({
        p_merchant_id: merchantId,
        p_customer_email: 'ada@example.com',
        p_quote_id: quoteId,
        p_service_type: 'dropoff',
      })
    );
  });

  it('bugfix: pickup create passes service_type so RPC persists awaiting_payment', async () => {
    const pickupInput: RepairBookingInput = {
      ...validInput,
      serviceType: 'pickup',
      pickupAddress: '12 Station Road, Osogbo, Osun, Nigeria',
    };

    const result = await createRepairBooking(pickupInput, merchantId);

    expect(result).toEqual({ success: true, id: 'repair-1', ticketNumber: 42 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_repair_booking',
      expect.objectContaining({
        p_merchant_id: merchantId,
        p_service_type: 'pickup',
        p_pickup_address: '12 Station Road, Osogbo, Osun, Nigeria',
      })
    );
  });

  it('stops before the RPC when the app-layer rate limit is exhausted', async () => {
    mocks.ensureActionRateLimit.mockResolvedValueOnce(false);

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Too many repair requests. Please try again in a minute.',
      code: 'rate_limited',
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid merchant id without calling the RPC', async () => {
    const result = await createRepairBooking(validInput, 'not-a-uuid');

    expect(result).toEqual({
      success: false,
      error: 'Invalid store reference.',
      code: 'invalid_merchant',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns field errors for invalid booking input without calling the RPC', async () => {
    const result = await createRepairBooking(
      { ...validInput, issueDescription: 'short' },
      merchantId
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.fieldErrors).toBeDefined();
    expect(result.code).toBe('validation_failed');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns validation_failed for malformed preferred dates before RPC conversion', async () => {
    const result = await createRepairBooking(
      { ...validInput, preferredDate: 'not-a-date' },
      merchantId
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.code).toBe('validation_failed');
    expect(result.fieldErrors?.preferredDate).toBeDefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('treats a cleared optional preferred date as omitted', async () => {
    const result = await createRepairBooking(
      { ...validInput, preferredDate: '' },
      merchantId
    );

    expect(result).toEqual({ success: true, id: 'repair-1', ticketNumber: 42 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_repair_booking',
      expect.objectContaining({ p_preferred_date: null })
    );
  });

  it('accepts datetime-local preferred dates from the booking picker', async () => {
    const result = await createRepairBooking(
      { ...validInput, preferredDate: '2026-06-03T14:30' },
      merchantId
    );

    expect(result).toEqual({ success: true, id: 'repair-1', ticketNumber: 42 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_repair_booking',
      expect.objectContaining({
        p_preferred_date: expect.stringMatching(
          /^2026-06-03T\d{2}:30:00\.000Z$/
        ),
      })
    );
  });

  it('maps a DB rate_limited error to the friendly rate-limit message', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'rate_limited' },
    });

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Too many repair requests. Please try again in a minute.',
      code: 'rate_limited',
    });
  });

  it('maps an inactive quote error to a friendly availability message', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'quote_unavailable' },
    });

    const result = await createRepairBooking(
      { ...validInput, quoteId },
      merchantId
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toMatch(/no longer available/i);
    expect(result.code).toBe('unavailable');
  });

  it('maps a merchant_not_found RPC error to the not_found code', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'merchant_not_found' },
    });

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Store not found.',
      code: 'not_found',
    });
  });

  it('maps a merchant_required RPC error to the not_found code', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'merchant_required' },
    });

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Store not found.',
      code: 'not_found',
    });
  });

  it('maps RPC input validation errors to the validation_failed code', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid_customer_email' },
    });

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Validation failed',
      code: 'validation_failed',
    });
  });

  it('falls back to the unknown code when the RPC error has no message', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: {} });

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Failed to submit repair request. Please try again.',
      code: 'unknown',
    });
  });

  it('returns a generic failure when the RPC returns no row', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await createRepairBooking(validInput, merchantId);

    expect(result).toEqual({
      success: false,
      error: 'Failed to submit repair request. Please try again.',
      code: 'unknown',
    });
  });
});
