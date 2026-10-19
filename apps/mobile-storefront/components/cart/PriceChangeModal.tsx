import Ionicons from '@react-native-vector-icons/ionicons';
import type React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import type {
  CartConditionChange,
  CartPriceChange,
  CartUnavailableLine,
} from '@/services/cart-reprice';
import { formatPrice } from '@/stores/cart-store';
import styles from './styles';

interface PriceChangeModalProps {
  visible: boolean;
  changes: CartPriceChange[];
  conditionChanges?: CartConditionChange[];
  unavailableLines?: CartUnavailableLine[];
  onClose: () => void;
  onDismissed?: () => void;
  colors: (typeof Colors)['light'];
}

export default function PriceChangeModal({
  visible,
  changes,
  conditionChanges = [],
  unavailableLines = [],
  onClose,
  onDismissed,
  colors,
}: PriceChangeModalProps): React.JSX.Element {
  const priceOnly =
    conditionChanges.length === 0 && unavailableLines.length === 0;
  const conditionOnly =
    changes.length === 0 &&
    conditionChanges.length > 0 &&
    unavailableLines.length === 0;
  const unavailableOnly =
    changes.length === 0 &&
    conditionChanges.length === 0 &&
    unavailableLines.length > 0;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      accessibilityViewIsModal
      onDismiss={onDismissed}
      onRequestClose={onClose}
    >
      <View style={styles.warningOverlay}>
        <Pressable
          style={styles.warningBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
        />
        <View style={[styles.warningModal, { backgroundColor: colors.card }]}>
          <View style={styles.warningHeader}>
            <View
              style={[
                styles.warningIconCircle,
                { backgroundColor: withAlpha(colors.warning, 0.16) },
              ]}
            >
              <Ionicons name="pricetag" size={20} color={colors.warning} />
            </View>
            <Text
              style={[styles.warningTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {unavailableOnly
                ? 'Items unavailable'
                : conditionOnly
                  ? 'Items updated'
                  : 'Prices updated'}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.warningClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.icon} />
            </Pressable>
          </View>

          <Text
            style={[styles.warningDescription, { color: colors.textSecondary }]}
          >
            {unavailableOnly
              ? 'Some items are no longer available and will block checkout. Remove them to continue.'
              : priceOnly
                ? 'Some prices changed since you added these items. Your cart now shows the latest prices — review and continue, or remove anything you no longer want.'
                : conditionOnly
                  ? 'The merchant updated some item details since you added these items. Your cart now shows the latest — review and continue, or remove anything you no longer want.'
                  : 'Some prices and item details changed since you added these items. Your cart now shows the latest — review and continue, or remove anything you no longer want.'}
          </Text>

          <ScrollView
            style={[styles.priceChangeList, { maxHeight: 260 }]}
            contentContainerStyle={styles.priceChangeListContent}
          >
            {changes.map((change) => (
              <View
                key={`price-${change.id}`}
                style={[styles.priceChangeRow, { borderColor: colors.border }]}
                accessible={true}
                accessibilityLabel={`${change.name}: price changed from ${formatPrice(
                  change.oldPrice
                )} to ${formatPrice(change.newPrice)}`}
              >
                <Text
                  style={[styles.priceChangeName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {change.name}
                </Text>
                <View style={styles.priceChangeValues}>
                  <Text
                    style={[
                      styles.priceChangeOld,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {formatPrice(change.oldPrice)}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={12}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.priceChangeNew, { color: colors.text }]}>
                    {formatPrice(change.newPrice)}
                  </Text>
                </View>
              </View>
            ))}
            {unavailableLines.map((line) => (
              <View
                key={`unavailable-${line.id}`}
                style={[styles.priceChangeRow, { borderColor: colors.border }]}
                accessible={true}
                accessibilityLabel={`${line.name}: no longer available`}
              >
                <Text
                  style={[styles.priceChangeName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {line.name}
                </Text>
                <View style={styles.priceChangeValues}>
                  <Text
                    style={[styles.priceChangeNew, { color: colors.warning }]}
                  >
                    Unavailable
                  </Text>
                </View>
              </View>
            ))}
            {conditionChanges.map((change) => (
              <View
                key={`condition-${change.id}`}
                style={[styles.priceChangeRow, { borderColor: colors.border }]}
                accessible={true}
                accessibilityLabel={`${change.name}: condition changed from ${change.oldCondition} to ${change.newCondition}`}
              >
                <Text
                  style={[styles.priceChangeName, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {change.name}
                </Text>
                <View style={styles.priceChangeValues}>
                  <Text
                    style={[
                      styles.priceChangeOld,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {change.oldCondition}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={12}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.priceChangeNew, { color: colors.text }]}>
                    {change.newCondition}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.warningButtons}>
            <View
              style={{
                backgroundColor: colors.primary,
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              <Pressable
                style={{ paddingVertical: 13, alignItems: 'center' }}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={
                  unavailableOnly
                    ? 'Continue after reviewing unavailable items'
                    : conditionOnly
                      ? 'Continue with updated items'
                      : 'Continue with updated prices'
                }
              >
                <Text
                  style={[
                    styles.warningPrimaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Continue
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
