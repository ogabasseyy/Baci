import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, View } from 'react-native';
import { SafeImage } from '@/components/ui/SafeImage';
import { BRAND, palette } from '@/constants/Colors';

/**
 * A product picture in a small white tile. Without a picture (or when it
 * fails to load) it shows a brand-red phone icon instead of a grey
 * "No Image" placeholder.
 */
export function SavingsProductThumb({
  uri,
  size = 56,
  title,
}: {
  uri?: string | null;
  size?: number;
  title?: string;
}) {
  const icon = (
    <Ionicons
      accessibilityLabel={title ? `${title}, no picture` : undefined}
      name="phone-portrait-outline"
      size={Math.round(size * 0.42)}
      color={BRAND.primary}
    />
  );
  const imageSize = Math.round(size * 0.86);
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size / 4) },
      ]}
    >
      {uri && isRealImage(uri) ? (
        <SafeImage
          accessibilityLabel={title}
          source={{ uri }}
          style={{ width: imageSize, height: imageSize }}
          contentFit="contain"
          fallbackComponent={icon}
        />
      ) : (
        icon
      )}
    </View>
  );
}

/** Generated "No Image" placeholder pictures count as no picture. */
function isRealImage(uri: string) {
  return !/placeholder|no[-_ ]?image|placehold\.co/i.test(uri);
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.red[100],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
