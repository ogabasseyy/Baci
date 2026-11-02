import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { OrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import { useTheme } from '@/hooks/useTheme';
import type { ShipmentCompletionMode } from '@/lib/order-shipment';
import { ShipmentFlowGiglWaybillPanel } from './ShipmentFlowGiglWaybillPanel';
import { ShipmentInfoCard } from './ShipmentInfoCard';
import { ShipmentOptionCard } from './ShipmentOptionCard';

interface ShipmentFlowMethodStepProps {
  canUseProvider: boolean;
  /** Formatted shipping price the customer paid with a saved checkout quote. */
  checkoutPaidShippingLabel?: string | null;
  /** "Already booked on GIG?" — omitted when the store cannot use GIG. */
  externalWaybill?: OrderGiglExternalWaybill;
  giglPanel?: ReactNode;
  onModeChange: (mode: ShipmentCompletionMode) => void;
  providerLabel: string | null;
  selectedMode: ShipmentCompletionMode;
}

export function ShipmentFlowMethodStep({
  canUseProvider,
  checkoutPaidShippingLabel,
  externalWaybill,
  giglPanel,
  onModeChange,
  providerLabel,
  selectedMode,
}: ShipmentFlowMethodStepProps) {
  const { colors } = useTheme();
  const providerDescription = providerLabel
    ? `This will book the shipment with ${providerLabel} using the saved checkout quote for this order.`
    : 'This will use the selected provider and saved checkout quote for this order.';
  // A fact only: booking can still ask for a new price (stale sender or price).
  const paidNote = checkoutPaidShippingLabel
    ? ` Customer paid ${checkoutPaidShippingLabel} for GIG delivery at checkout.`
    : '';

  return (
    <>
      <ShipmentInfoCard
        colors={colors}
        icon="cube-outline"
        subtitle="You can still override the provider and use your own rider for this shipment."
        title="Choose how this order should leave your store."
      />

      <View accessibilityRole="radiogroup">
        {giglPanel ?? (
          <ShipmentOptionCard
            colors={colors}
            description={
              !canUseProvider
                ? providerLabel
                  ? `${providerLabel} was selected for checkout, but this order does not have a saved quote to book against anymore.`
                  : 'No provider-backed shipping quote is currently saved on this order.'
                : `${providerDescription}${paidNote}`
            }
            disabled={!canUseProvider}
            icon="paper-plane-outline"
            onPress={() => onModeChange('provider')}
            selected={selectedMode === 'provider'}
            title={
              providerLabel ? `Use ${providerLabel}` : 'Use Selected Provider'
            }
          />
        )}

        {externalWaybill ? (
          <ShipmentFlowGiglWaybillPanel
            externalWaybill={externalWaybill}
            onSelect={() => onModeChange('external_waybill')}
            selected={selectedMode === 'external_waybill'}
          />
        ) : null}

        <ShipmentOptionCard
          colors={colors}
          description="Use your own dispatch rider instead. We’ll save the rider number for reuse and you can share it with the customer after dispatch."
          icon="bicycle-outline"
          onPress={() => onModeChange('self_fulfillment')}
          selected={selectedMode === 'self_fulfillment'}
          title="Self Fulfill"
        />
      </View>
    </>
  );
}
