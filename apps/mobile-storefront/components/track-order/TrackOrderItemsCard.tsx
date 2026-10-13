import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { trackOrderScreenStyles as styles } from './TrackOrderScreen.styles';
import type { TrackOrderData } from './TrackOrderScreen.types';
import { formatTrackOrderPrice } from './track-order.helpers';

type ColorsScheme = (typeof Colors)['light'];

interface TrackOrderItemsCardProps {
  colors: ColorsScheme;
  currency: string;
  items: TrackOrderData['items'];
}

export function TrackOrderItemsCard({
  colors,
  currency,
  items,
}: TrackOrderItemsCardProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Items ({items.length})
      </Text>
      {items.map((item) => (
        <View
          key={item.id}
          style={[styles.itemRow, { borderBottomColor: colors.border }]}
        >
          {item.product_image ? (
            <Image
              source={createSafeBoundedImageSource({
                fit: 'cover',
                height: 48,
                uri: item.product_image,
                width: 48,
              })}
              style={styles.itemImage}
              contentFit="cover"
              autoplay={false}
            />
          ) : (
            <View
              style={[
                styles.itemImagePlaceholder,
                { backgroundColor: colors.border },
              ]}
            >
              <Ionicons
                name="cube-outline"
                size={20}
                color={colors.textSecondary}
              />
            </View>
          )}
          <View style={styles.itemInfo}>
            <Text
              style={[styles.itemName, { color: colors.text }]}
              numberOfLines={2}
            >
              {item.product_name}
            </Text>
            <Text style={[styles.itemQty, { color: colors.textSecondary }]}>
              Qty: {item.quantity}
            </Text>
          </View>
          <Text style={[styles.itemPrice, { color: colors.text }]}>
            {formatTrackOrderPrice(item.total_price, currency)}
          </Text>
        </View>
      ))}
    </View>
  );
}
