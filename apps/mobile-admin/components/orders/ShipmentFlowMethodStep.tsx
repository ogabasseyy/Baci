import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { ShipmentCompletionMode } from '@/lib/order-shipment';
import { ShipmentOptionCard } from './ShipmentOptionCard';

interface ShipmentFlowMethodStepProps {
  canUseProvider: boolean;
  /** Formatted shipping price the customer paid with a saved checkout quote. */
  checkoutPaidShippingLabel?: string | null;
  giglPanel?: ReactNode;
  onModeChange: (mode: ShipmentCompletionMode) => void;
  providerLabel: string | null;
  selectedMode: ShipmentCompletionMode;
}

export function ShipmentFlowMethodStep({
  canUseProvider,
  checkoutPaidShippingLabel,
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

      <ShipmentOptionCard
        colors={colors}
        description="Use your own dispatch rider"
        icon="bicycle-outline"
        onPress={() => onModeChange('self_fulfillment')}
        selected={selectedMode === 'self_fulfillment'}
        title="Self Fulfill"
      />
    </View>
  );
}
