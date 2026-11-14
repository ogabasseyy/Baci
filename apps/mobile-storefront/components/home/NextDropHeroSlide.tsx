import Ionicons from '@react-native-vector-icons/ionicons';
import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type Href, useRouter } from 'expo-router';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { SavingsProviderPreview } from '@/components/wallet/SavingsProviderPreview';

export function NextDropHeroSlide({
  width,
  height,
  artwork,
  showSavingsProvider,
  title,
  subtitle,
  ctaText,
  ctaLink,
}: {
  width: number;
  height: number;
  artwork: ImageSource;
  showSavingsProvider?: boolean;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: Href;
}) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();

  return (
    <View style={[styles.slide, { width, height }]}>
      <View style={[styles.card, width < 360 && styles.compactCard]}>
        <LinearGradient
          colors={['#190a11', '#3b101d', '#260b14']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Image
          accessible={false}
          source={artwork}
          contentFit="cover"
          contentPosition="top right"
          style={[
            StyleSheet.absoluteFill,
            height > 220 && {
              top: (height - 220) / 2,
              bottom: (height - 220) / 2,
            },
          ]}
        />
        <LinearGradient
          colors={['#190a11', '#190a1100']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 0.65, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.copy}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              width < 400 && fontScale > 1.2 && styles.scaledTitle,
            ]}
            maxFontSizeMultiplier={1.5}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} maxFontSizeMultiplier={1.5}>
              {subtitle}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(ctaLink)}
            style={styles.action}
          >
            <Text style={styles.actionText} maxFontSizeMultiplier={1.5}>
              {ctaText}
            </Text>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </Pressable>
        </View>
        {showSavingsProvider && __DEV__ && (
          <View style={styles.providerCredit}>
            <SavingsProviderPreview subtle />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: '#200a12',
    borderColor: '#4a1d26',
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  providerCredit: { position: 'absolute', right: 8, bottom: 8 },
  compactCard: { borderRadius: 16 },
  copy: { alignItems: 'flex-start', gap: 10, paddingLeft: 16, width: '57%' },
  title: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 26,
    letterSpacing: -0.7,
  },
  subtitle: { color: '#f5d9df', fontSize: 14, fontWeight: '500' },
  scaledTitle: { fontSize: 21 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 8,
    borderColor: '#a46a77',
    borderWidth: 1,
    backgroundColor: '#2b0e17',
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 11,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 13, flexShrink: 1 },
});
