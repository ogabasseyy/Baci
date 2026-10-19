import { describe, expect, it, vi } from 'vitest';
import type { ServiceRoleClient } from '@/lib/payments/paid-order-side-effect-types';
import { loadGiglSettlementRetainedAmount } from './load-gigl-settlement-retained-amount';

function createSupabase(result: {
  data: { metadata: Record<string, unknown> } | null;
  error: { message: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const neqStatus = vi.fn(() => ({ maybeSingle }));
  const eqSourceId = vi.fn(() => ({ neq: neqStatus }));
  const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
  const eqGatewayReference = vi.fn(() => ({ eq: eqSourceType }));
  const eqGateway = vi.fn(() => ({ eq: eqGatewayReference }));
  const select = vi.fn(() => ({ eq: eqGateway }));
  const from = vi.fn(() => ({ select }));

  return {
    eqGateway,
    eqGatewayReference,
    eqSourceId,
    eqSourceType,
    from,
    neqStatus,
    supabase: { from } as unknown as ServiceRoleClient,
  };
}

const lookup = {
  gateway: 'paystack',
  gatewayReference: 'BAC-REF-1',
  sourceId: 'order-1',
  sourceType: 'order',
} as const;

describe('loadGiglSettlementRetainedAmount', () => {
  it('reads the authoritative retained amount from a scoped settlement row', async () => {
    const {
      eqGateway,
      eqGatewayReference,
      eqSourceId,
      eqSourceType,
      from,
      neqStatus,
      supabase,
    } = createSupabase({
      data: { metadata: { retained_shipping_amount: 8_500 } },
      error: null,
    });

    await expect(
      loadGiglSettlementRetainedAmount(supabase, lookup)
    ).resolves.toBe(8_500);
    expect(from).toHaveBeenCalledWith('merchant_settlements');
    expect(eqGateway).toHaveBeenCalledWith('gateway', lookup.gateway);
    expect(eqGatewayReference).toHaveBeenCalledWith(
      'gateway_reference',
      lookup.gatewayReference
    );
    expect(eqSourceType).toHaveBeenCalledWith('source_type', lookup.sourceType);
    expect(eqSourceId).toHaveBeenCalledWith('source_id', lookup.sourceId);
    expect(neqStatus).toHaveBeenCalledWith('status', 'cancelled');
  });

  it('bugfix: excludes cancelled settlements from the retained-amount lookup', async () => {
    const { neqStatus, supabase } = createSupabase({
      data: { metadata: { retained_shipping_amount: 4_200 } },
      error: null,
    });

    await expect(
      loadGiglSettlementRetainedAmount(supabase, lookup)
    ).resolves.toBe(4_200);
    expect(neqStatus).toHaveBeenCalledWith('status', 'cancelled');
  });

  it('fails closed when the scoped settlement row is missing', async () => {
    const { supabase } = createSupabase({ data: null, error: null });

    await expect(
      loadGiglSettlementRetainedAmount(supabase, lookup)
    ).rejects.toThrow('settlement row missing');
  });
});
