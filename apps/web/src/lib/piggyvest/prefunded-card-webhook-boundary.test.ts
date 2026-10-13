import { describe, expect, it } from 'vitest';
import { prefundedCardWebhookBoundary } from './prefunded-card-webhook-boundary';

describe('prefunded first-card webhook boundary', () => {
  it.each([
    { data: { reference: 'pvb-first-test' } },
    { data: { reference: 'PVB-FIRST-test' } },
    { data: { metadata: { transaction_type: 'prefunded_first_card' } } },
    { data: { metadata: '{"transaction_type":"prefunded_first_card"}' } },
  ])('requires dedicated reconciliation instead of acknowledging legacy settlement: %j', async (body) => {
    const response = prefundedCardWebhookBoundary(body);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('retry-after')).toBe('60');
    expect(await response?.json()).toHaveProperty(
      'code',
      'PREFUNDED_FIRST_CARD_WEBHOOK_UNAVAILABLE'
    );
  });

  it.each([
    null,
    [],
    {},
    { data: null },
    { data: { metadata: '{bad' } },
    {
      data: {
        reference: 'WAL-TEST-123',
        metadata: { transaction_type: 'wallet_top_up' },
      },
    },
    { data: { reference: 'order-123' } },
  ])('leaves unrelated events on their existing path: %j', (body) => {
    expect(prefundedCardWebhookBoundary(body)).toBeNull();
  });
});
