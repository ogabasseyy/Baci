import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { lookupErrorResponse } from './lookup-error-response';

describe('lookupErrorResponse', () => {
  it('logs the lookup failure and returns a 500 invalid response', async () => {
    const response = lookupErrorResponse(
      'Probe lookup failed',
      new Error('boom'),
      'merchant-1'
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      valid: false,
      error: 'Internal server error',
    });
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith({
      message: 'Probe lookup failed',
      error: expect.any(Error),
      merchantId: 'merchant-1',
    });
  });
});
