import { StyleSheet, Text, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';

interface JustLaunchedSkeletonColors {
  background: string;
  border: string;
  card: string;
  text: string;
}

interface JustLaunchedSkeletonProps {
  cardWidth: number;
  colors: JustLaunchedSkeletonColors;
  title: string;
}

/**
 * First-load placeholder for the Just Launched carousel: two skeleton
 * cards under the section heading so the feed never shows a blank gap
 * while products and pins resolve.
 */
export function JustLaunchedSkeleton({
  cardWidth,
  colors,
  title,
}: JustLaunchedSkeletonProps) {
  return (
    <View style={styles.container}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.text }]}
      >
        {title}
      </Text>
      <View style={styles.list}>
        {[0, 1].map((key) => (
          <View
            key={key}
            style={[
              styles.card,
              {
                width: cardWidth,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[styles.imageWrap, { backgroundColor: colors.background }]}
            >
              <Skeleton width="100%" height={140} borderRadius={8} />
            </View>
            <View style={styles.info}>
              <Skeleton width="40%" height={10} />
              <Skeleton style={styles.skeletonGap} width="85%" height={16} />
              <Skeleton style={styles.skeletonGap} width="55%" height={14} />
              <Skeleton style={styles.skeletonGap} width="35%" height={13} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  list: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    height: 168,
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  imageWrap: {
    width: '42%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  info: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    gap: 2,
  },
  skeletonGap: {
    marginTop: 6,
  },
});
