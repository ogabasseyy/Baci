import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';

export function OxygenStatusCard({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon:
    | 'time-outline'
    | 'home-outline'
    | 'card-outline'
    | 'checkmark-circle-outline';
  eyebrow: string;
  title: string;
  description: string;
}) {
  const colors = useOxygenColors();
  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: colors.primaryLowOpacity,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <Text
          style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}
        >
          {eyebrow}
        </Text>
      </View>
      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          borderRadius: 20,
          padding: 22,
          gap: 12,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text,
            fontSize: 23,
            lineHeight: 30,
            fontWeight: '700',
          }}
        >
          {title}
        </Text>
        <Text
          style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 23 }}
        >
          {description}
        </Text>
      </View>
    </View>
  );
}
