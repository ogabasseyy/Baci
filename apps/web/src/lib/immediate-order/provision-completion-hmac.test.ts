import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisionImmediateNotificationCompletionHmac } from './provision-completion-hmac';

describe('provisionImmediateNotificationCompletionHmac', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes the app env secret into the shared DB setter RPC', async () => {
    vi.stubEnv(
      'IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET',
      'deployment-shared-secret-value-32b'
    );
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await provisionImmediateNotificationCompletionHmac({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith(
      'set_immediate_notification_completion_hmac_secret',
      { p_secret: 'deployment-shared-secret-value-32b' }
    );
  });

  it('fails closed when the shared secret is missing or too short', async () => {
    vi.stubEnv('IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET', 'short');
    await expect(
      provisionImmediateNotificationCompletionHmac({
        rpc: vi.fn(),
      } as never)
    ).rejects.toThrow(/IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET/);
  });
});
