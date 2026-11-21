import { Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenAction } from './oxygen-presentation';

export function OxygenOfferRefresh({
  disabled,
  onRefresh,
}: {
  disabled: boolean;
  onRefresh: () => void;
}) {
  const colors = useOxygenColors();
  return (
    <View>
      <Text style={{ color: colors.text }}>
        We need to update your payment options before you continue.
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        If Oxygen can’t provide them, go back and choose another payment method.
      </Text>
      <OxygenAction
        label="Update payment options"
        disabled={disabled}
        onPress={onRefresh}
      />
    </View>
  );
}
