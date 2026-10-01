import Ionicons from '@react-native-vector-icons/ionicons';
import type React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import styles from './styles';

interface NegotiationWarningModalProps {
  visible: boolean;
  pendingItem: CartItem | null;
  hasNonNegotiableCartItem?: boolean;
  onClose: () => void;
  onDismissed?: () => void;
  onNegotiateItem: (item: CartItem) => void;
  onBulkNegotiate: () => void;
  triggerHaptic: () => void;
  colors: (typeof Colors)['light'];
}

export default function NegotiationWarningModal({
  visible,
  pendingItem,
  hasNonNegotiableCartItem = false,
  onClose,
  onDismissed,
  onNegotiateItem,
  onBulkNegotiate,
  triggerHaptic,
  colors,
}: NegotiationWarningModalProps): React.JSX.Element {
  const canNegotiateItem = !!pendingItem;
  const canBulkNegotiate = !hasNonNegotiableCartItem;
  const handleNegotiateItemPress = () => {
    if (!pendingItem) {
      return;
    }
    triggerHaptic();
    onNegotiateItem(pendingItem);
  };

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
              <Ionicons name="cash-outline" size={20} color={colors.warning} />
            </View>
            <Text
              style={[styles.warningTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              Negotiation Mode
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
            Negotiating items individually will disable bulk cart negotiation.
          </Text>
          <Text
            style={[styles.warningDescriptionEmphasis, { color: colors.text }]}
          >
            You can only use one approach.
          </Text>

          <View style={styles.warningButtons}>
            {/* Pressable Layout Lesson: box (bg/border/radius) on the View,
                Pressable only handles the press with a plain style. */}
            <View
              style={{
                backgroundColor: colors.primary,
                borderRadius: 16,
                overflow: 'hidden',
                opacity: canNegotiateItem ? 1 : 0.45,
              }}
            >
              <Pressable
                style={{ paddingVertical: 13, alignItems: 'center' }}
                onPress={handleNegotiateItemPress}
                disabled={!canNegotiateItem}
                accessibilityRole="button"
                accessibilityLabel="Negotiate this item"
                accessibilityState={{ disabled: !canNegotiateItem }}
              >
                <Text
                  style={[
                    styles.warningPrimaryButtonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Negotiate This Item
                </Text>
              </Pressable>
            </View>

            <View
              style={{
                backgroundColor: colors.muted,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 16,
                overflow: 'hidden',
                opacity: canBulkNegotiate ? 1 : 0.45,
              }}
            >
              <Pressable
                style={{
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onPress={() => {
                  if (!canBulkNegotiate) {
                    return;
                  }
                  triggerHaptic();
                  onBulkNegotiate();
                }}
                disabled={!canBulkNegotiate}
                accessibilityRole="button"
                accessibilityLabel="Bulk negotiate entire cart"
                accessibilityState={{ disabled: !canBulkNegotiate }}
              >
                <Ionicons name="cash-outline" size={18} color={colors.text} />
                <Text
                  style={[
                    styles.warningSecondaryButtonText,
                    { color: colors.text },
                  ]}
                >
                  Bulk Negotiate Entire Cart
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
