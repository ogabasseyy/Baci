import { describe, expect, it } from 'vitest';
import { reconcileGatewayPassDeadlineMs } from './reconcile-gateway-paid-orders-budget';

describe('reconcileGatewayPassDeadlineMs', () => {
  it('splits the invocation budget into equal cumulative shares', () => {
    // 270s after the margin split three ways: 90s per pass.
    expect(reconcileGatewayPassDeadlineMs(1_000_000, 0)).toBe(1_090_000);
    expect(reconcileGatewayPassDeadlineMs(1_000_000, 1)).toBe(1_180_000);
    expect(reconcileGatewayPassDeadlineMs(1_000_000, 2)).toBe(1_270_000);
  });
});
