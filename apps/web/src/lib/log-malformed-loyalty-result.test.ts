import { describe, expect, it, vi } from 'vitest';

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: errorLog },
}));

import { logMalformedLoyaltyResult } from './log-malformed-loyalty-result';

describe('logMalformedLoyaltyResult', () => {
  it('logs only issue codes and paths, never payload values', () => {
    logMalformedLoyaltyResult('Malformed loyalty status result', [
      { code: 'invalid_type', path: ['transactions', 0, 'redemption_code'] },
    ]);

    expect(errorLog).toHaveBeenCalledWith({
      message: 'Malformed loyalty status result',
      error: {
        issues: [
          {
            code: 'invalid_type',
            path: ['transactions', 0, 'redemption_code'],
          },
        ],
      },
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('RDM-');
  });
});
