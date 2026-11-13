import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function BlackFridayHeroSlide({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <View style={[styles.slide, { width, height }]}>
      <Link href="/black-friday" asChild>
        <Pressable
          accessibilityLabel="Shop Black Friday"
          accessibilityRole="link"
          style={styles.banner}
        >
          <Image
            accessible={false}
            contentFit="cover"
            source={require('@/assets/images/campaigns/black-friday.webp')}
            style={styles.artwork}
          />
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.title}
          >
            Black <Text style={styles.accent}>Friday</Text>
          </Text>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.action}
          >
            Shop the lineup →
          </Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { paddingHorizontal: 16, paddingBottom: 24 },
  banner: {
    flex: 1,
    backgroundColor: '#10090b',
    borderColor: '#4b2026',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 16,
  },
  artwork: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: '48%',
    height: '100%',
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1.5,
    maxWidth: '52%',
  },
  accent: { color: '#ff626d' },
  action: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 8,
    color: '#161014',
    fontSize: 13,
    fontWeight: '700',
    maxWidth: '52%',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
});
