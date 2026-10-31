import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('emitPiggyvestWebhookAlert', () => {
  it('writes one structured, greppable line with allowlisted detail only', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEY_REVOKED', {
      keyVersion: 'pv-2026-09',
      attempts: 3,
      // @ts-expect-error unknown fields must never be logged
      body: '{"secret":"leak"}',
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      '[PiggyVest Webhook][ALERT] PIGGYVEST_WEBHOOK_KEY_REVOKED {"keyVersion":"pv-2026-09","attempts":3}'
    );
  });

  it('names the operation of a transfer held for review', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitPiggyvestWebhookAlert('PIGGYVEST_TRANSFER_NEEDS_REVIEW', {
      reason: 'savings_reference_not_found',
      operationId: '00000000-0000-4000-8000-000000000002',
    });
    expect(error).toHaveBeenCalledWith(
      '[PiggyVest Webhook][ALERT] PIGGYVEST_TRANSFER_NEEDS_REVIEW {"reason":"savings_reference_not_found","operationId":"00000000-0000-4000-8000-000000000002"}'
    );
  });

  it('bounds free-text detail', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_CAPTURE_FAILED', {
      reason: 'x'.repeat(500),
    });
    expect(String(error.mock.calls[0]?.[0]).length).toBeLessThan(260);
  });
});
