import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
import type { OxygenHostedKind } from './oxygen-hosted-navigation';

export function OxygenHostedHeader({
  kind,
  onExit,
}: {
  kind: OxygenHostedKind;
  onExit: () => void;
}) {
  const colors = useOxygenColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderBottomWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Return to saved progress"
        onPress={onExit}
        style={{
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </Pressable>
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}
      >
        {kind === 'selfie' ? 'Verify it’s you' : 'Secure payment'}
      </Text>
    </View>
  );
}
