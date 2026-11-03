import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  getErrorCode,
  resolveStoredOperation,
} from './stored-contribution-operation';

const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheckStatus(...args),
}));

const run = (operationId: string | null, isPrimary = true) =>
  resolveStoredOperation({ merchantId: 'm1', operationId, isPrimary });

describe('resolveStoredOperation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mints fresh without a stored id', async () => {
    expect(await run(null)).toEqual({ operationId: null, confirmed: false });
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('skips the status call for legacy customers', async () => {
    expect(await run('op', false)).toEqual({
      operationId: 'op',
      confirmed: false,
    });
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('keeps a pending id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'pending' });
    expect(await run('op')).toEqual({ operationId: 'op', confirmed: false });
  });

  it('flags a confirmed id so it is not submitted again', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'confirmed' });
    expect(await run('op')).toEqual({ operationId: 'op', confirmed: true });
  });

  it('drops a cancelled id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'cancelled' });
    expect(await run('op')).toEqual({ operationId: null, confirmed: false });
  });

  it('keeps the id when primary has no record (legacy may hold it)', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    expect(await run('op')).toEqual({ operationId: 'op', confirmed: false });
  });

  it('keeps the id when the lookup is ambiguous', async () => {
    mockCheckStatus.mockRejectedValue(new Error('network'));
    expect(await run('op')).toEqual({ operationId: 'op', confirmed: false });
  });
});

describe('getErrorCode', () => {
  it('reads string codes only', () => {
    expect(getErrorCode({ code: 'A' })).toBe('A');
    expect(getErrorCode({ code: 1 })).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});
