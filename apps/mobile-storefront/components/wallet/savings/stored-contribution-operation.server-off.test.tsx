import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import {
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { resolveStoredOperation } from './stored-contribution-operation';

jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

// A merchant the server keeps off cannot hold a primary record: stored ids
// stay on the legacy rail and the primary status endpoint is not consulted
// for them.
describe('server keeps PiggyVest off', () => {
  it('keeps a legacy id on legacy without a status call', async () => {
    await expect(
      resolveStoredOperation({
        merchantId: SERVER_OFF_MERCHANT_ID,
        operationId: 'op-1',
        rail: 'legacy',
      })
    ).resolves.toEqual({
      operationId: 'op-1',
      rail: 'legacy',
      confirmed: false,
    });
    expect(checkPiggyvestPrimarySavingsStatus).not.toHaveBeenCalled();
  });

  it('mints a fresh id when none is stored, without a status call', async () => {
    await expect(
      resolveStoredOperation({
        merchantId: SERVER_OFF_MERCHANT_ID,
        operationId: null,
        rail: null,
      })
    ).resolves.toEqual({ operationId: null, rail: null, confirmed: false });
    expect(checkPiggyvestPrimarySavingsStatus).not.toHaveBeenCalled();
  });

  it('treats an unrecorded id as legacy when the merchant is not primary', async () => {
    jest
      .mocked(checkPiggyvestPrimarySavingsStatus)
      .mockRejectedValue(serverOffError('SAVINGS_MERCHANT_NOT_PRIMARY'));
    await expect(
      resolveStoredOperation({
        merchantId: SERVER_OFF_MERCHANT_ID,
        operationId: 'op-2',
        rail: null,
      })
    ).resolves.toEqual({
      operationId: 'op-2',
      rail: 'legacy',
      confirmed: false,
    });
  });
});
