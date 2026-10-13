import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairBookingInput } from '@/lib/validations/repair';
import { findResumablePickupRepair } from './find-resumable-repair-pickup';
import { repairPickupResumeClaims } from './repair-pickup-resume-claim';

const mocks = vi.hoisted(() => ({
  createRepairPickupReceiverClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/repairs/repair-pickup-receiver-client', () => ({
  createRepairPickupReceiverClient: mocks.createRepairPickupReceiverClient,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';
const secret = 'paystack-secret-for-tests';
const input = {
  customerEmail: 'ada@example.com',
  customerName: 'Ada Lovelace',
  customerPhone: '+2348012345678',
  deviceModel: 'iPhone 15',
  deviceType: 'Smartphone',
  issueDescription: 'The screen no longer responds to touch.',
  pickupAddress: '12 Station Road, Osogbo',
  preferredDate: '2026-09-10T09:00',
  serviceType: 'pickup',
} as RepairBookingInput;

describe('findResumablePickupRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reclaims the newest unpaid pickup when details match without a resume token', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: repairId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: input.pickupAddress,
        },
      ],
      error: null,
    });

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken: null,
      secret,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('find_resumable_repair_pickup', {
      p_merchant_id: merchantId,
      p_customer_email: input.customerEmail,
      p_repair_id: null,
    });
    expect(result).toEqual({
      kind: 'found',
      repair: { success: true, id: repairId, ticketNumber: 17 },
    });
  });

  it('does not reclaim by email alone when saved pickup details differ', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: repairId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: '99 Different Street, Lagos',
        },
      ],
      error: null,
    });

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken: null,
      secret,
    });

    expect(result).toEqual({ kind: 'none' });
  });

  it('reclaims only when the signed resume token matches the unpaid repair', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: repairId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: input.pickupAddress,
        },
      ],
      error: null,
    });
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId,
      },
      secret
    );

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken,
      secret,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('find_resumable_repair_pickup', {
      p_merchant_id: merchantId,
      p_customer_email: input.customerEmail,
      p_repair_id: repairId,
    });
    expect(result).toEqual({
      kind: 'found',
      repair: { success: true, id: repairId, ticketNumber: 17 },
    });
  });

  it('rejects resume when the saved pickup address no longer matches', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: repairId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: '99 Different Street, Lagos',
        },
      ],
      error: null,
    });
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId,
      },
      secret
    );

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken,
      secret,
    });

    expect(result).toEqual({ kind: 'none' });
  });

  it('rejects resume when the saved device no longer matches', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: repairId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: 'Pixel 9',
          device_type: input.deviceType,
          pickup_address: input.pickupAddress,
        },
      ],
      error: null,
    });
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId,
      },
      secret
    );

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken,
      secret,
    });

    expect(result).toEqual({ kind: 'none' });
  });

  it('fails closed when the scoped resume lookup errors', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'jwt expired' },
    });
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId,
      },
      secret
    );

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken,
      secret,
    });

    expect(result).toMatchObject({ kind: 'error' });
  });

  it('bugfix: rejects a present-but-invalid resume token without creating a sibling', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken: 'not-a-valid-resume-capability',
      secret,
    });

    expect(result).toMatchObject({ kind: 'invalid_resume' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('bugfix: rejects a resume token signed with a rotated secret', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId,
      },
      'old-rotated-secret'
    );

    const result = await findResumablePickupRepair({
      input,
      merchantId,
      resumeToken,
      secret,
    });

    expect(result).toMatchObject({ kind: 'invalid_resume' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
