import type { ServiceRoleClient } from '@/lib/payments/paid-order-side-effect-types';

function parseRetainedShippingAmount(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 0;
  }

  const retained = Number(
    (metadata as { retained_shipping_amount?: unknown })
      .retained_shipping_amount ?? 0
  );
  return Number.isFinite(retained) ? Math.max(0, retained) : 0;
}

export type GiglSettlementRetainedAmountLookup = {
  gateway: string;
  gatewayReference: string;
  sourceId: string;
  sourceType: string;
};

export async function loadGiglSettlementRetainedAmount(
  supabase: ServiceRoleClient,
  lookup: GiglSettlementRetainedAmountLookup
): Promise<number> {
  const { data, error } = await supabase
    .from('merchant_settlements')
    .select('metadata')
    .eq('gateway', lookup.gateway)
    .eq('gateway_reference', lookup.gatewayReference)
    .eq('source_type', lookup.sourceType)
    .eq('source_id', lookup.sourceId)
    .neq('status', 'cancelled')
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load GIGL settlement retained amount: ${error.message}`
    );
  }
  if (!data) {
    throw new Error(
      'Failed to load GIGL settlement retained amount: settlement row missing'
    );
  }

  return parseRetainedShippingAmount(data.metadata);
}
