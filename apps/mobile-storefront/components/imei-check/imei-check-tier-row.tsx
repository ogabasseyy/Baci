import type { ImeiServiceTierDefinition } from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import { formatServicePrice } from './format-service-price';
import type { ImeiCheckerColors } from './imei-check.types';
import { pickerStyles as styles } from './imei-check-picker.styles';

/**
 * One check inside a group card: a radio dot, name and tagline, the price,
 * and an info button that opens the in-app details sheet.
 */
export function ImeiCheckTierRow({
  colors,
  divider,
  isSelected,
  tier,
  onPress,
  onShowDetails,
}: {
  colors: ImeiCheckerColors;
  divider: boolean;
  isSelected: boolean;
  tier: ImeiServiceTierDefinition;
  onPress: () => void;
  onShowDetails: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${tier.name}, ${formatServicePrice(tier.price)}`}
      style={[
        styles.row,
        divider && {
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        isSelected && { backgroundColor: withAlpha(BRAND.primary, 0.06) },
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.radio,
          { borderColor: isSelected ? BRAND.primary : colors.border },
          isSelected && { backgroundColor: BRAND.primary },
        ]}
      >
        {isSelected ? (
          <Ionicons name="checkmark" size={13} color={BRAND.onPrimary} />
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowNameLine}>
          <Text
            style={[
              styles.rowName,
              { color: isSelected ? BRAND.primary : colors.text },
            ]}
            numberOfLines={1}
          >
            {tier.name}
          </Text>
          {tier.recommended ? (
            <View
              style={[
                styles.bestBadge,
                { backgroundColor: withAlpha(BRAND.primary, 0.12) },
              ]}
            >
              <Text style={[styles.bestText, { color: BRAND.primary }]}>
                Best value
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          style={[styles.rowTagline, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {tier.tagline}
        </Text>
      </View>
      <Text
        style={[
          styles.rowPrice,
          { color: isSelected ? BRAND.primary : colors.text },
        ]}
      >
        {formatServicePrice(tier.price)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`What ${tier.name} includes`}
        hitSlop={10}
        onPress={onShowDetails}
        style={styles.infoButton}
      >
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={colors.textSecondary}
        />
      </Pressable>
    </Pressable>
  );
}
