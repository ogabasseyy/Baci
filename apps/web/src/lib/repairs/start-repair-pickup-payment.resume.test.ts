import { beforeEach, describe, expect, it } from 'vitest';
import './start-repair-pickup-payment.test-support';
import { repairPickupResumeClaims } from './repair-pickup-resume-claim';
import { startRepairPickupPayment } from './start-repair-pickup-payment';
import {
  arrangeStartRepairPickupPayment,
  getStartRepairPickupPaymentMocks,
  startRepairPickupPaymentInput,
  startRepairPickupPaymentMerchantId,
} from './start-repair-pickup-payment.test-support';

const mocks = getStartRepairPickupPaymentMocks();
const input = startRepairPickupPaymentInput;
const merchantId = startRepairPickupPaymentMerchantId;

describe('startRepairPickupPayment resume and validation', () => {
  beforeEach(arrangeStartRepairPickupPayment);

  it('reclaims an unpaid pickup only with a signed resume capability', async () => {
    const existingId = '323e4567-e89b-12d3-a456-426614174000';
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId: existingId,
      },
      'paystack-secret-for-tests'
    );
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: existingId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: input.pickupAddress,
        },
      ],
      error: null,
    });

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
      resumeToken,
    });

    expect(mocks.createRepairPickupReceiverClient).toHaveBeenCalledWith(
      merchantId
    );
    expect(mocks.rpc).toHaveBeenCalledWith('find_resumable_repair_pickup', {
      p_merchant_id: merchantId,
      p_customer_email: input.customerEmail,
      p_repair_id: existingId,
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.markRepairPickupAwaitingPayment).toHaveBeenCalledWith({
      merchantId,
      repairId: existingId,
    });
    expect(mocks.bindRepairPickupPendingPaymentReference).toHaveBeenCalledWith({
      merchantId,
      repairId: existingId,
      reference: expect.stringMatching(/^RPU-[A-Z0-9]{16}$/),
    });
    expect(result).toMatchObject({
      success: true,
      id: existingId,
      ticketNumber: 17,
    });
    expect(result).toHaveProperty('resumeToken');
  });

  it('reclaims a matching unpaid pickup on double submit without a resume token', async () => {
    const existingId = '323e4567-e89b-12d3-a456-426614174000';
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: existingId,
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: input.pickupAddress,
        },
      ],
      error: null,
    });

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('find_resumable_repair_pickup', {
      p_merchant_id: merchantId,
      p_customer_email: input.customerEmail,
      p_repair_id: null,
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      id: existingId,
      ticketNumber: 17,
    });
  });

  it('does not reclaim by email alone when saved pickup details differ', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          id: '323e4567-e89b-12d3-a456-426614174000',
          ticket_number: 17,
          customer_phone: input.customerPhone,
          device_model: input.deviceModel,
          device_type: input.deviceType,
          pickup_address: '99 Different Street, Lagos',
        },
      ],
      error: null,
    });

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(mocks.createRepairBooking).toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      ticketNumber: 42,
    });
  });

  it('fails closed when the scoped resume lookup errors', async () => {
    const existingId = '323e4567-e89b-12d3-a456-426614174000';
    const resumeToken = repairPickupResumeClaims.create(
      {
        customerEmail: input.customerEmail,
        issuedAt: Date.now(),
        merchantId,
        repairId: existingId,
      },
      'paystack-secret-for-tests'
    );
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'jwt expired' },
    });

    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
      resumeToken,
    });

    expect(result).toEqual({
      success: false,
      code: 'lookup_failed',
      error:
        'We could not resume your saved pickup request. Please try again shortly.',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
  });

  it('bugfix: does not create a new repair when the resume token is invalid', async () => {
    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'ogabassey',
      resumeToken: 'tampered-or-rotated-resume-token',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'resume_invalid',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.initializeTransaction).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid expected pickup fees before merchant lookup', async () => {
    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: -10,
      merchantId,
      merchantIdentifier: 'ogabassey',
    });

    expect(result).toEqual({
      success: false,
      code: 'validation_failed',
      error: 'Enter valid repair and pickup details.',
    });
    expect(mocks.resolveRepairPickupPaymentMerchant).not.toHaveBeenCalled();
  });

  it('rejects a non-string or oversized merchant identifier before lookup', async () => {
    const result = await startRepairPickupPayment({
      data: input,
      expectedPickupFee: 8250,
      merchantId,
      merchantIdentifier: 'a'.repeat(121) as never,
    });

    expect(result).toEqual({
      success: false,
      code: 'validation_failed',
      error: 'Enter valid repair and pickup details.',
    });
    expect(mocks.resolveRepairPickupPaymentMerchant).not.toHaveBeenCalled();
  });
});
