import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ probe: vi.fn() }));

vi.mock('./quarantine-refunded-leg-terminal-anomaly', () => ({
  quarantineRefundedLegTerminalAnomaly: mocks.probe,
}));

import { probeRefundedLegManualPending } from './probe-refunded-leg-manual-pending';

const leg = (id: string, status: string) => ({ id, status }) as never;

describe('probeRefundedLegManualPending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves empty without probing when no refunded leg exists', async () => {
    const legs = [leg('payment-1', 'completed')];

    await expect(
      probeRefundedLegManualPending({
        actionableLegCount: 1,
        linkLegs: legs,
        order: {} as never,
        soleCompletedLegId: 'payment-1',
        supabase: {} as never,
      })
    ).resolves.toEqual(new Set());
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it('returns the probe manual-pending ids when refunded legs exist', async () => {
    const legs = [leg('payment-1', 'completed'), leg('payment-2', 'refunded')];
    mocks.probe.mockResolvedValue({
      refundedManualPendingLegIds: new Set(['payment-2']),
    });

    await expect(
      probeRefundedLegManualPending({
        actionableLegCount: 1,
        linkLegs: legs,
        order: {} as never,
        soleCompletedLegId: 'payment-1',
        supabase: {} as never,
      })
    ).resolves.toEqual(new Set(['payment-2']));
    expect(mocks.probe).toHaveBeenCalledOnce();
  });
});
