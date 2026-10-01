import { formatOrderItemOptionLabel } from '@baci/shared/lib';
import { Image } from 'expo-image';
import { Text, TouchableOpacity, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { orderDetailsScreenStyles as styles } from './OrderDetailsScreen.styles';
import type { OrderItem } from './OrderDetailsScreen.types';

type ColorsScheme = (typeof Colors)['light'];

interface OrderDetailsItemsCardProps {
  colors: ColorsScheme;
  items: OrderItem[];
  onOpenProduct: (slug: string) => void;
}

export function OrderDetailsItemsCard({
  colors,
  items,
  onOpenProduct,
}: OrderDetailsItemsCardProps) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Items ({items.length})
      </Text>
      {items.map((item) => {
        const productName = item.product_name || 'product';
        const optionLabel = formatOrderItemOptionLabel({
          condition: item.condition,
          variantName: item.variant_name,
        });
        const accessibilityProductLabel = optionLabel
          ? `${productName}, ${optionLabel}`
          : productName;

        return (
          <TouchableOpacity
            key={item.id}
            style={styles.orderItem}
            onPress={() => onOpenProduct(item.product_slug)}
            accessibilityRole="button"
            accessibilityLabel={`View ${accessibilityProductLabel} details`}
          >
            <Image
              source={createSafeBoundedImageSource({
                fit: 'cover',
                height: 64,
                uri: item.image_url || 'https://via.placeholder.com/80',
                width: 64,
              })}
              style={styles.itemImage}
              contentFit="cover"
              autoplay={false}
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${item.product_name || 'Product'} image`}
            />
            <View style={styles.itemDetails}>
              <Text
                style={[styles.itemName, { color: colors.text }]}
                numberOfLines={2}
              >
                {item.product_name}
              </Text>
              {optionLabel && (
                <Text
                  style={[
                    styles.itemOptionLabel,
                    { color: colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {optionLabel}
                </Text>
              )}
              <View style={styles.itemPriceRow}>
                <Text
                  style={[styles.itemQuantity, { color: colors.textSecondary }]}
                >
                  Qty: {item.quantity}
                </Text>
                <Text style={[styles.itemPrice, { color: colors.text }]}>
                  {formatNgnCurrency(item.price * item.quantity)}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
