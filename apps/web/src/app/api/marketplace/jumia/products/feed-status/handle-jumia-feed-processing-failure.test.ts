import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/jumia/helpers', () => ({
  JumiaApiError: class JumiaApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  jumiaErrorResponse: (error: { status: number }) =>
    Response.json({ error: 'Jumia error' }, { status: error.status }),
}));

import { JumiaApiError } from '@/lib/jumia/helpers';
import { handleJumiaFeedProcessingFailure } from './handle-jumia-feed-processing-failure';

describe('handleJumiaFeedProcessingFailure', () => {
  it('preserves provider error responses', async () => {
    const response = handleJumiaFeedProcessingFailure({
      error: new JumiaApiError(429, 'rate limited'),
      feedId: 'feed-1',
    });

    expect(response.status).toBe(429);
  });

  it('returns a stable gateway error for local failures', async () => {
    const response = handleJumiaFeedProcessingFailure({
      error: new Error('database failure'),
      feedId: 'feed-1',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to reconcile Jumia feed',
    });
  });
});
