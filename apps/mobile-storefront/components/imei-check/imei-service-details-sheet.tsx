import type { ImeiServiceTierDefinition } from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { walletPinSheetStyles as sheetStyles } from '@/components/wallet/savings/WalletPinSheet.styles';
import { BRAND } from '@/constants/Colors';
import { formatServicePrice } from './format-service-price';
import type { ImeiCheckerColors } from './imei-check.types';
import { pickerStyles as styles } from './imei-check-picker.styles';

/**
 * What a check includes, in the same bottom sheet as the savings PIN steps
 * (never an iOS alert). Choosing it from here selects it and closes.
 */
export function ImeiServiceDetailsSheet({
  colors,
  tier,
  onChoose,
  onClose,
}: {
  colors: ImeiCheckerColors;
  tier: ImeiServiceTierDefinition | null;
  onChoose: () => void;
  onClose: () => void;
}) {
  return (
    <ModalSheet
      visible={tier !== null}
      animationType="slide"
      backdropStyle={sheetStyles.backdrop}
      onRequestClose={onClose}
      onBackdropPress={onClose}
    >
      {tier ? (
        <View
          style={[sheetStyles.sheet, { backgroundColor: colors.background }]}
        >
          <View style={sheetStyles.header}>
            <View
              style={[
                sheetStyles.icon,
                { backgroundColor: colors.primaryLowOpacity },
              ]}
            >
              <Ionicons name={tier.icon} size={16} color={BRAND.primary} />
            </View>
            <Text
              accessibilityRole="header"
              style={[sheetStyles.title, { color: BRAND.primary }]}
            >
              {tier.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              onPress={onClose}
              style={sheetStyles.close}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={[styles.detailsTagline, { color: colors.text }]}>
            {tier.tagline}
          </Text>
          <Text style={[styles.detailsBody, { color: colors.textSecondary }]}>
            {tier.detail}
          </Text>
          <View style={[styles.detailsList, { backgroundColor: colors.muted }]}>
            {tier.features.map((feature) => (
              <View key={feature} style={styles.detailsItem}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={BRAND.primary}
                />
                <Text style={[styles.detailsItemText, { color: colors.text }]}>
                  {feature}
                </Text>
              </View>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Choose ${tier.name}`}
            onPress={onChoose}
            style={[sheetStyles.primary, { backgroundColor: BRAND.primary }]}
          >
            <Text style={[sheetStyles.primaryText, { color: BRAND.onPrimary }]}>
              {`Choose this check · ${formatServicePrice(tier.price)}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </ModalSheet>
  );
}
