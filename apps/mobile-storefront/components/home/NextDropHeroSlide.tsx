import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';

export function NextDropHeroSlide({
  width,
  height,
  title,
  subtitle,
  ctaText,
  ctaLink,
}: {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: Href;
}) {
  const router = useRouter();

  return (
    <View style={[styles.slide, { width, height }]}>
      <View style={styles.card}>
        <Image
          accessible={false}
          source={require('@/assets/images/campaigns/device-savings.webp')}
          contentFit="cover"
          contentPosition="right"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(ctaLink)}
            style={styles.action}
          >
            <Text style={styles.actionText}>{ctaText}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flex: 1,
    backgroundColor: '#200a12',
    borderColor: '#4a1d26',
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  copy: { alignItems: 'flex-start', gap: 7, paddingLeft: 16, width: '65%' },
  title: {
    color: '#fff',
    fontFamily: 'Inter_900Black',
    fontSize: 22,
    letterSpacing: -0.7,
    lineHeight: 25,
  },
  subtitle: { color: '#f5d9df', fontSize: 13, lineHeight: 17 },
  action: {
    backgroundColor: BRAND.primary,
    borderRadius: 24,
    minHeight: 44,
    paddingHorizontal: 13,
    justifyContent: 'center',
  },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
