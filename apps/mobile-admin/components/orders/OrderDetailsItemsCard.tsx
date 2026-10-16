import Ionicons from '@react-native-vector-icons/ionicons';
import { Alert, Pressable, Text, View } from 'react-native';
import SafeImage from '@/components/ui/SafeImage';
import type { ThemeColors } from '@/constants/theme';
import { formatProductCondition } from '@/lib/product-condition';
import type { OrderDetailsItem } from './order-details.types';
import { orderDetailsItemsStyles as styles } from './order-details-items.styles';

// Dynamic import: expo-clipboard pulls native modules that test runners
// without the Expo runtime cannot load; copy is press-time only.
async function copyOfferRef(offerId: string) {
  const clipboard = await import('expo-clipboard');
  await clipboard.setStringAsync(offerId);
}

interface OrderDetailsItemsCardProps {
  colors: ThemeColors;
  formatPrice: (amount: number) => string;
  items: OrderDetailsItem[];
  onSelectItem: (item: OrderDetailsItem) => void;
}

export function OrderDetailsItemsCard({
  colors,
  formatPrice,
  items,
  onSelectItem,
}: OrderDetailsItemsCardProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.cardTitle, { color: colors.text }]}>
        Items ({items.length || 0})
      </Text>
      {items.map((item, index) => {
        const conditionLabel = formatProductCondition(
          item.display_condition ?? item.condition
        );
        const imageUrl = item.display_image_url ?? item.image_url;
        const isLastItem = index === items.length - 1;

        // The row is a View with separate press targets: nesting the
        // copy control inside the select pressable would stack two
        // buttons (a focus/voice-control hazard on web) and
        // double-trigger without stopPropagation, which native
        // responder events do not guarantee.
        return (
          <View
            key={item.id}
            style={[
              styles.itemRow,
              !isLastItem && {
                borderBottomColor: colors.border,
                borderBottomWidth: 1,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, quantity ${item.quantity}`}
              accessibilityHint="Opens the details for this item"
              onPress={() => onSelectItem(item)}
              style={styles.itemRowPressable}
            >
              <View
                style={[
                  styles.itemImagePlaceholder,
                  { backgroundColor: colors.backgroundLight },
                ]}
              >
                {imageUrl ? (
                  <SafeImage
                    source={{ uri: imageUrl }}
                    style={styles.itemImage}
                  />
                ) : (
                  <Ionicons
                    color={colors.textMuted}
                    name="image-outline"
                    size={24}
                  />
                )}
              </View>
              <View style={styles.itemDetails}>
                <Text
                  numberOfLines={2}
                  style={[styles.itemName, { color: colors.text }]}
                >
                  {item.name}
                </Text>
                {conditionLabel ? (
                  <Text
                    style={[styles.itemCondition, { color: colors.primary }]}
                  >
                    Condition: {conditionLabel}
                  </Text>
                ) : null}
                {(() => {
                  // The stored snapshot outlives the catalog row: when the
                  // offer was deleted after purchase, offer_id no longer
                  // resolves but the snapshotted grade/notes remain the
                  // creation-time truth, so render them without a ref.
                  const offerParts = [
                    item.offer_grade ? `Grade ${item.offer_grade}` : null,
                    item.offer_condition_notes ?? null,
                  ].filter(Boolean);
                  return offerParts.length > 0 ? (
                    <Text
                      style={[
                        styles.itemVariant,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Offer: {offerParts.join(' · ')}
                    </Text>
                  ) : null;
                })()}
                {item.variant_name ? (
                  <Text
                    style={[
                      styles.itemVariant,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {item.variant_name}
                  </Text>
                ) : null}
                {item.product_id ? (
                  <Text style={[styles.itemRef, { color: colors.textMuted }]}>
                    SKU:{' '}
                    {item.product_id.length > 8
                      ? `${item.product_id.slice(0, 8)}...`
                      : item.product_id}
                  </Text>
                ) : null}
                <View style={styles.itemPriceRow}>
                  <Text
                    style={[styles.itemQty, { color: colors.textSecondary }]}
                  >
                    x{item.quantity}
                  </Text>
                  <Text style={[styles.itemPrice, { color: colors.text }]}>
                    {formatPrice(item.price)}
                  </Text>
                </View>
              </View>
              <Ionicons
                color={colors.textMuted}
                name="chevron-forward"
                size={20}
              />
            </Pressable>
            {item.offer_id ? (
              // Truncated for scannability: an 8-char prefix can collide
              // across offers, so the full id stays one tap away via
              // copy (and in the accessibility label for screen
              // readers). A sibling of the select pressable, so no
              // stopPropagation is needed.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Copy full offer reference ${String(item.offer_id)}`}
                // 12px text/icon alone is far below the 44pt minimum
                // target; expand the touch area without moving layout.
                hitSlop={12}
                onPress={() => {
                  // Clipboard writes can reject (permissions, web
                  // denial): surface a failure instead of failing
                  // silent on a ref the truncated label never confirms.
                  copyOfferRef(String(item.offer_id)).catch(() => {
                    Alert.alert(
                      'Copy failed',
                      'Could not copy the offer reference. Please try again.'
                    );
                  });
                }}
                style={[styles.offerRefRow, { marginTop: 0 }]}
              >
                <Text
                  style={[styles.itemVariant, { color: colors.textSecondary }]}
                >
                  ref {String(item.offer_id).slice(0, 8)}
                </Text>
                <Ionicons
                  color={colors.textSecondary}
                  name="copy-outline"
                  size={12}
                />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
