import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import SafeImage from '@/components/ui/SafeImage';
import type { ThemeColors } from '@/constants/theme';
import { formatProductCondition } from '@/lib/product-condition';
import type { OrderDetailsItem } from './order-details.types';
import { orderDetailsItemsStyles as styles } from './order-details-items.styles';

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

        return (
          <Pressable
            key={item.id}
            onPress={() => onSelectItem(item)}
            style={[
              styles.itemRow,
              !isLastItem && {
                borderBottomColor: colors.border,
                borderBottomWidth: 1,
              },
            ]}
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
                <Text style={[styles.itemCondition, { color: colors.primary }]}>
                  Condition: {conditionLabel}
                </Text>
              ) : null}
              {item.offer_id ? (
                <Text
                  style={[styles.itemVariant, { color: colors.textSecondary }]}
                >
                  Offer:{' '}
                  {[
                    item.offer_grade ? `Grade ${item.offer_grade}` : null,
                    item.offer_condition_notes ?? null,
                    // Full id: an 8-char prefix can collide across offers
                    // and this detail view is where admins resolve exactly
                    // which condition offer a line refers to.
                    `ref ${String(item.offer_id)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
              {item.variant_name ? (
                <Text
                  style={[styles.itemVariant, { color: colors.textSecondary }]}
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
                <Text style={[styles.itemQty, { color: colors.textSecondary }]}>
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
        );
      })}
    </View>
  );
}
