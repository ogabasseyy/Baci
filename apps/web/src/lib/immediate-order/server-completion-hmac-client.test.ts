import { describe, expect, it, vi } from 'vitest';

const createServiceClient = vi.fn(() => ({ branded: true }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient,
}));

describe('createImmediateNotificationCompletionHmacServiceClient', () => {
  it('constructs the dedicated immediate-notification-completion sentinel', async () => {
    const { createImmediateNotificationCompletionHmacServiceClient } =
      await import('./server-completion-hmac-client');

    expect(createImmediateNotificationCompletionHmacServiceClient()).toEqual({
      branded: true,
    });
    expect(createServiceClient).toHaveBeenCalledWith(
      'immediate-notification-completion'
    );
  });
});
