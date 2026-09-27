import type { JumiaClient } from '@/lib/jumia/client';
import { packOrderV2 } from '@/lib/jumia/fulfillment';
import { getShipmentProviders } from '@/lib/jumia/orders';
import { resolvePackProviders } from './pack-provider-selection';

type Status = 'full' | 'partial' | 'failed';
function computeStatus(success: number, errors: number): Status {
  if (success === 0 && errors === 0) return 'failed';
  if (errors === 0) return 'full';
  if (success > 0) return 'partial';
  return 'failed';
}
export async function executePackAction(args: {
  client: JumiaClient;
  targetItemIds: string[];
  shipmentProviderId?: string;
  trackingCode?: string;
  isAllItems: boolean;
  orderId: string;
  merchantId: string;
  updateOrderStatus: (
    orderId: string,
    merchantId: string,
    status: string
  ) => Promise<{ syncWarning: string; details: string } | undefined>;
}) {
  const hasExplicitProvider = args.shipmentProviderId && args.trackingCode;
  const providers = hasExplicitProvider
    ? undefined
    : await getShipmentProviders(args.client, args.targetItemIds);
  const selection = resolvePackProviders(
    args.targetItemIds,
    Array.isArray(providers?.orderItems) ? providers.orderItems : [],
    args.shipmentProviderId
  );
  if (!args.shipmentProviderId && selection.providerByItem.size === 0)
    return { error: 'No shipment provider available' as const };
  if (selection.trackingCodeRequired && !args.trackingCode)
    return {
      error:
        'trackingCode is required for the selected shipment provider' as const,
    };
  const result = await packOrderV2(
    args.client,
    args.targetItemIds
      .filter((id) => selection.providerByItem.has(id))
      .map((id) => ({
        orderItems: id,
        shipmentProviderId: selection.providerByItem.get(id) as string,
        trackingCode: args.trackingCode,
      }))
  );
  // Items without a shipment provider are never submitted to Jumia; they count
  // as failures so the result cannot report "full" for a partial pack.
  const failedItems =
    (result.error?.total ?? 0) + selection.skippedItems.length;
  const status = computeStatus(result.success?.total ?? 0, failedItems);
  const sync =
    status === 'full' && selection.skippedItems.length === 0 && args.isAllItems
      ? await args.updateOrderStatus(args.orderId, args.merchantId, 'Packed')
      : undefined;
  return {
    status,
    successCount: result.success?.total ?? 0,
    errorCount: failedItems,
    packages: result.success?.packages ?? [],
    ...(selection.skippedItems.length > 0 && {
      skippedItems: selection.skippedItems,
      skippedReason: 'No shipment provider available for these items',
    }),
    ...sync,
  };
}
