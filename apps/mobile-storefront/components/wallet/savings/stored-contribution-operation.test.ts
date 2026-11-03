import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  getErrorCode,
  reusableStoredOperationId,
} from './stored-contribution-operation';

const mockCheckStatus = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-primary-savings-status', () => ({
  checkPiggyvestPrimarySavingsStatus: (...args: unknown[]) =>
    mockCheckStatus(...args),
}));

const run = (operationId: string | null, isPrimary = true) =>
  reusableStoredOperationId({ merchantId: 'm1', operationId, isPrimary });

describe('reusableStoredOperationId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null without a stored id', async () => {
    expect(await run(null)).toBeNull();
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('skips the status call for legacy customers', async () => {
    expect(await run('op', false)).toBe('op');
    expect(mockCheckStatus).not.toHaveBeenCalled();
  });

  it('keeps a pending or confirmed id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'pending' });
    expect(await run('op')).toBe('op');
    mockCheckStatus.mockResolvedValue({ status: 'confirmed' });
    expect(await run('op')).toBe('op');
  });

  it('drops a cancelled id', async () => {
    mockCheckStatus.mockResolvedValue({ status: 'cancelled' });
    expect(await run('op')).toBeNull();
  });

  it('drops an id the server has no record of', async () => {
    mockCheckStatus.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'CONTRIBUTION_NOT_FOUND' })
    );
    expect(await run('op')).toBeNull();
  });

  it('keeps the id when the lookup is ambiguous', async () => {
    mockCheckStatus.mockRejectedValue(new Error('network'));
    expect(await run('op')).toBe('op');
  });
});

describe('getErrorCode', () => {
  it('reads string codes only', () => {
    expect(getErrorCode({ code: 'A' })).toBe('A');
    expect(getErrorCode({ code: 1 })).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});
