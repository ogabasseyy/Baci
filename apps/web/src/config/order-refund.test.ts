import { describe, expect, it } from 'vitest';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import {
  describeRefundManageBlocked,
  describeRefundWorkerError,
  orderRefundStatusLabels,
} from './order-refund';

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

describe('refund worker error labels', () => {
  it('labels awaiting codes as in progress', () => {
    expect(
      describeRefundWorkerError(
        'cancellation_refund_awaiting_manual_completion'
      )
    ).toContain('in progress');
  });
  it('labels reconciliation failures as needs review', () => {
    expect(
      describeRefundWorkerError(
        'An existing Paystack refund requires reconciliation before retry'
      )
    ).toContain('needs review');
  });
  it('falls back to a generic label for unknown messages', () => {
    const label = describeRefundWorkerError(
      'Paystack/insufficient-balance (acquirer 51)'
    );
    expect(label).toContain('ran into a problem');
    expect(label).not.toContain('acquirer');
  });
});

describe('refund manage-blocked labels', () => {
  it('explains in-flight steps as processing', () => {
    expect(describeRefundManageBlocked('processing')).toContain(
      'being processed'
    );
  });
  it('explains review steps as under review', () => {
    expect(describeRefundManageBlocked('requires_review')).toContain(
      'under review'
    );
  });
  it('keeps the permission message otherwise', () => {
    for (const status of ['failed', 'queued', 'not_started'])
      expect(describeRefundManageBlocked(status)).toContain(
        'refund permission'
      );
  });
});
