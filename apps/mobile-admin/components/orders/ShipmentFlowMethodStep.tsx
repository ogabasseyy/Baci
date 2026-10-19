import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { ShipmentCompletionMode } from '@/lib/order-shipment';
import { ShipmentInfoCard } from './ShipmentInfoCard';
import { ShipmentOptionCard } from './ShipmentOptionCard';

interface ShipmentFlowMethodStepProps {
  canUseProvider: boolean;
  giglPanel?: ReactNode;
  onModeChange: (mode: ShipmentCompletionMode) => void;
  providerLabel: string | null;
  selectedMode: ShipmentCompletionMode;
}

export function ShipmentFlowMethodStep({
  canUseProvider,
  giglPanel,
  onModeChange,
  providerLabel,
  selectedMode,
}: ShipmentFlowMethodStepProps) {
  const { colors } = useTheme();
  const providerDescription = providerLabel
    ? `This will book the shipment with ${providerLabel} using the saved checkout quote for this order.`
    : 'This will use the selected provider and saved checkout quote for this order.';

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
                : providerDescription
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
