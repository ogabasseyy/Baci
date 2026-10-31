import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { TYPOGRAPHY } from '@/constants/theme';
import { styles } from './ShipmentFlowSheet.styles';

export interface ShipmentOptionDetail {
  text: string;
  tone?: 'muted' | 'warning';
}

interface ShipmentOptionCardProps {
  colors: ThemeColors;
  description: string;
  details?: ShipmentOptionDetail[];
  disabled?: boolean;
  icon: IoniconsIconName;
  onPress: () => void;
  price?: string;
  selected: boolean;
  title: string;
}

export function ShipmentOptionCard({
  colors,
  description,
  details = [],
  disabled = false,
  icon,
  onPress,
  price,
  selected,
  title,
}: ShipmentOptionCardProps) {
  const accessibilityLabel = [
    title,
    description,
    price,
    ...details.map((detail) => detail.text),
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="radio"
      accessibilityState={{ disabled, checked: selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionCard,
        {
          backgroundColor: selected ? colors.primaryLight : colors.card,
          borderColor: selected ? colors.primary : colors.border,
          opacity: disabled ? 0.48 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.optionIconWrap,
          {
            backgroundColor: selected
              ? colors.primaryLight
              : colors.backgroundLight,
          },
        ]}
      >
        <Ionicons
          color={selected ? colors.primary : colors.textSecondary}
          name={icon}
          size={18}
        />
      </View>
      <View style={styles.optionCopy}>
        <Text style={[styles.optionTitle, { color: colors.text }]}>
          {title}
        </Text>
        <Text
          style={[styles.optionDescription, { color: colors.textSecondary }]}
        >
          {description}
        </Text>
        {price ? (
          <Text style={[cardStyles.price, { color: colors.text }]}>
            {price}
          </Text>
        ) : null}
        {details.map((detail) => (
          <Text
            key={detail.text}
            style={[
              cardStyles.detail,
              {
                color:
                  detail.tone === 'warning'
                    ? colors.warning
                    : colors.textSecondary,
              },
            ]}
          >
            {detail.text}
          </Text>
        ))}
      </View>
      <Ionicons
        color={selected ? colors.primary : colors.textMuted}
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
      />
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  detail: {
    fontSize: TYPOGRAPHY.size.sm,
  },
  price: {
    fontSize: TYPOGRAPHY.size.xl,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    marginTop: 2,
  },
});
