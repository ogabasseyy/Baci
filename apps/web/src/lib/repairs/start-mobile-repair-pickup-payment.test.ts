import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  start: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/paystack', () => ({ verifyTransaction: mocks.verify }));
vi.mock('@/lib/repairs/repair-pickup-receiver-client', () => ({
  createRepairPickupReceiverClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/repairs/start-repair-pickup-payment', () => ({
  startRepairPickupPayment: mocks.start,
}));

import { startMobileRepairPickupPayment } from './start-mobile-repair-pickup-payment';

const input = {
  requestId: '14bf2192-16de-442b-bf75-700f4ff2aaca',
  merchantId: 'merchant',
  merchantIdentifier: 'test',
  expectedPickupFee: 3000,
  data: {},
};
const result = {
  success: true,
  id: 'repair',
  ticketNumber: 123,
  resumeToken: 'token',
  payment: {
    amount: 3000,
    authorizationUrl: 'https://checkout.paystack.com/test',
    reference: 'ref',
  },
};
describe('mobile pickup payment receipt', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reconciles the saved reference after a crash following initialization without starting again', async () => {
    const unknown = {
      success: false,
      code: 'payment_initialization_unknown',
      error: 'unknown',
      id: 'repair',
      ticketNumber: 123,
      resumeToken: 'token',
      reference: 'ref',
      amountKobo: 300000,
      currency: 'NGN',
    };
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: 'claimed' } })
      .mockResolvedValueOnce({ data: true })
      .mockResolvedValueOnce({ data: { state: 'unknown', result: unknown } })
      .mockResolvedValueOnce({ data: { state: 'unknown', result: unknown } });
    mocks.start.mockImplementationOnce(
      async ({ onPaymentInitializationStarted }) => {
        await onPaymentInitializationStarted(unknown);
        throw new Error('process lost');
      }
    );
    mocks.verify.mockResolvedValue({ success: false });
    await expect(startMobileRepairPickupPayment(input)).rejects.toThrow(
      'process lost'
    );
    expect(await startMobileRepairPickupPayment(input)).toEqual(unknown);
    expect(mocks.verify).toHaveBeenCalledWith('ref');
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it('replays the completed start after the first HTTP response was lost without another provider start', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: 'claimed' } })
      .mockResolvedValueOnce({ data: true })
      .mockResolvedValueOnce({ data: { state: 'complete', result } })
      .mockResolvedValueOnce({ data: { state: 'complete', result } });
    mocks.start.mockResolvedValue(result);
    await startMobileRepairPickupPayment(input);
    const replay = await startMobileRepairPickupPayment(input);
    expect(replay).toEqual(result);
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
  it('never re-executes a pending or unknown start', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'pending' } });
    await expect(startMobileRepairPickupPayment(input)).rejects.toThrow(
      'still being reconciled'
    );
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('fails closed before provider access when receipt storage is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'offline' } });
    await expect(startMobileRepairPickupPayment(input)).rejects.toThrow();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('does not start payment when another worker reclaimed the expired claim', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: 'claimed' } })
      .mockResolvedValueOnce({ error: { message: 'claim ownership changed' } });
    mocks.start.mockResolvedValue(result);
    await expect(startMobileRepairPickupPayment(input)).rejects.toThrow();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('keeps an interrupted completion unknown rather than initializing again', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: 'claimed' } })
      .mockResolvedValueOnce({ data: true })
      .mockResolvedValueOnce({ error: { message: 'offline' } })
      .mockResolvedValueOnce({ data: { state: 'pending' } });
    mocks.start.mockResolvedValue(result);
    await expect(startMobileRepairPickupPayment(input)).rejects.toThrow();
    await expect(startMobileRepairPickupPayment(input)).rejects.toThrow();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
