import { Image } from 'expo-image';
import { Link, Stack } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { isOgabasseyApp, useBlackFriday } from '@/hooks/use-black-friday';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';

export default function BlackFridayScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { data, isPending, isError, refetch } = useBlackFriday();

  return (
    <StorefrontScreenShell themeBackground>
      <Stack.Screen options={{ title: 'Black Friday', headerShown: true }} />
      <FlatList
        contentContainerStyle={styles.content}
        data={isError ? [] : data}
        keyExtractor={(product) => product.id}
        ListHeaderComponent={
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text accessibilityRole="header" style={styles.title}>
                Black <Text style={styles.accent}>Friday</Text>
              </Text>
              <Text style={styles.subtitle}>
                Find your next upgrade in our Black Friday lineup.
              </Text>
            </View>
            <Image
              accessible={false}
              contentFit="cover"
              contentPosition="bottom"
              source={require('@/assets/images/campaigns/black-friday.webp')}
              style={styles.heroArtwork}
            />
          </View>
        }
        ListEmptyComponent={
          isOgabasseyApp && isPending ? (
            <ActivityIndicator
              accessibilityLabel="Loading Black Friday offers"
              color={colors.text}
            />
          ) : isError ? (
            <View style={styles.message}>
              <Text style={{ color: colors.text }}>
                Black Friday offers couldn’t load.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refetch()}
                style={styles.retry}
              >
                <Text style={[styles.link, { color: colors.text }]}>
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.message}>
              <Text style={{ color: colors.text }}>
                {isOgabasseyApp
                  ? 'Our Black Friday lineup will appear here when it’s ready.'
                  : 'Black Friday offers are unavailable in this store.'}
              </Text>
              <Link
                href="/"
                style={StyleSheet.flatten([
                  styles.link,
                  { color: colors.text },
                ])}
              >
                Back to home
              </Link>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Link
            href={{ pathname: '/product/[slug]', params: { slug: item.slug } }}
            asChild
          >
            <Pressable
              accessibilityRole="link"
              style={StyleSheet.flatten([
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ])}
            >
              {item.image ? (
                <Image
                  accessible={false}
                  autoplay={false}
                  contentFit="contain"
                  enforceEarlyResizing
                  source={createSafeBoundedImageSource({
                    uri: item.image,
                    width: 88,
                    height: 88,
                  })}
                  style={styles.image}
                />
              ) : null}
              <View style={styles.product}>
                <Text style={[styles.name, { color: colors.text }]}>
                  {item.name}
                </Text>
                <Text style={[styles.price, { color: colors.text }]}>
                  {item.price}
                </Text>
                {item.compareAtPrice ? (
                  <Text
                    accessibilityLabel={`Original price ${item.compareAtPrice}`}
                    style={[styles.originalPrice, { color: colors.text }]}
                  >
                    {item.compareAtPrice}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </Link>
        )}
      />
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  hero: {
    backgroundColor: '#10090b',
    borderColor: '#4b2026',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  heroCopy: { padding: 20, gap: 8 },
  heroArtwork: { width: '100%', aspectRatio: 2 },
  title: { color: '#ffffff', fontSize: 40, fontWeight: '900' },
  accent: { color: '#ff626d' },
  subtitle: { color: '#d4d4d8', fontSize: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  image: { width: 88, height: 88, borderRadius: 8, backgroundColor: '#fafafa' },
  product: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: '600' },
  price: { fontWeight: '700' },
  originalPrice: { textDecorationLine: 'line-through' },
  message: { gap: 10, paddingVertical: 12 },
  retry: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  link: { fontWeight: '700', textDecorationLine: 'underline' },
});
