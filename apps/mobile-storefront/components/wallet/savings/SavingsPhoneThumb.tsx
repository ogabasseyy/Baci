import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { styles } from './savings-phone-swap.styles';

/** A phone's picture in a small rounded tile, or a phone icon without one. */
export function SavingsPhoneThumb({
  background,
  iconColor,
  image,
  title,
}: {
  background: string;
  iconColor: string;
  image?: string | null;
  title: string;
}) {
  return (
    <View style={[styles.thumb, { backgroundColor: background }]}>
      {image ? (
        <Image
          accessibilityLabel={title}
          source={createSafeBoundedImageSource({
            height: 44,
            uri: image,
            width: 40,
          })}
          style={styles.image}
          contentFit="contain"
          autoplay={false}
        />
      ) : (
        <Ionicons name="phone-portrait-outline" size={22} color={iconColor} />
      )}
    </View>
  );
}
