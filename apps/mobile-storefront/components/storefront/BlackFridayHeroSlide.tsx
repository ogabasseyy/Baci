import { OGABASSEY_BLACK_FRIDAY_DATE_LABEL } from '@baci/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function BlackFridayHeroSlide({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const router = useRouter();

  return (
    <View style={[styles.slide, { width, height }]}>
      <Pressable
        accessibilityLabel={`Shop Black Friday, ${OGABASSEY_BLACK_FRIDAY_DATE_LABEL}`}
        accessibilityRole="button"
        onPress={() => router.push('/black-friday')}
        style={styles.banner}
      >
        <Image
          accessible={false}
          contentFit="contain"
          source={require('@/assets/images/campaigns/black-friday.webp')}
          style={styles.artwork}
        />
        <LinearGradient
          colors={['#10090b', '#10090b', '#10090b00']}
          locations={[0, 0.34, 0.57]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
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
          style={styles.date}
        >
          {OGABASSEY_BLACK_FRIDAY_DATE_LABEL}
        </Text>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={styles.action}
        >
          Shop the lineup →
        </Text>
      </Pressable>
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
    gap: 7,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 16,
  },
  artwork: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: '72%',
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
  date: { color: '#ffd5dc', fontSize: 13, fontWeight: '600', maxWidth: '51%' },
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
