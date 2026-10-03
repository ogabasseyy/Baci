import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markCorrectiveRetry,
  retryDelayMs,
} from './order-notification-outbox-corrective-retry';

vi.mock('./order-notification-outbox-status', async () => {
  const actual = await vi.importActual<
    typeof import('./order-notification-outbox-status')
  >('./order-notification-outbox-status');

  return {
    ...actual,
    updateOutboxStatus: vi.fn(),
  };
});

import { updateOutboxStatus } from './order-notification-outbox-status';

describe('retryDelayMs', () => {
  it('backs off exponentially from a five-minute base', () => {
    expect(retryDelayMs(0)).toBe(5 * 60 * 1000);
    expect(retryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(retryDelayMs(2)).toBe(10 * 60 * 1000);
  });

  it('caps at one hour', () => {
    expect(retryDelayMs(99)).toBe(60 * 60 * 1000);
  });
});

describe('markCorrectiveRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reserves a fresh pending attempt past the failure ceiling', async () => {
    const summary = { retried: 0 };

    await markCorrectiveRetry(
      {} as never,
      { id: 'row-1', claim_owner: 'worker-1' },
      summary
    );

    expect(updateOutboxStatus).toHaveBeenCalledWith(
      {},
      { id: 'row-1', claim_owner: 'worker-1' },
      expect.objectContaining({
        attempt_count: 0,
        last_error: 'document_changed_during_send',
        status: 'pending',
      })
    );
    expect(summary.retried).toBe(1);
  });
});
