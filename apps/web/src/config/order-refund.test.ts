import { describe, expect, it } from 'vitest';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { orderRefundStatusLabels } from './order-refund';

const statuses: RefundSummary['status'][] = [
  'refunded',
  'processing',
  'requires_review',
  'queued',
  'failed',
  'not_started',
];

describe('refund display labels', () => {
  it.each(
    statuses
  )('displays a readable label for server status %s', (status) => {
    expect(orderRefundStatusLabels[status]).toMatch(/\S/);
    expect(orderRefundStatusLabels[status]).not.toContain('_');
  });
  it('renders worker and audit states without exposing their internal identifiers', () => {
    for (const action of [
      'claimed',
      'completed',
      'delivery_uncertain',
      'existing_state',
      'retry_requested',
      'manual_recorded',
      'provider_confirmed',
    ]) {
      expect(orderRefundStatusLabels[action]).toMatch(/\S/);
      expect(orderRefundStatusLabels[action]).not.toContain('_');
    }
  });
});
