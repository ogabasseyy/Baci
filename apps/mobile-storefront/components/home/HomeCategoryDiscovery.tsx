import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCategories } from '@/hooks/use-categories';
import { useTheme } from '@/hooks/useTheme';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';

const categories = [
  {
    label: 'Phones',
    query: 'smartphones',
    slugs: ['phones', 'smartphones', 'mobile-phones'],
    icon: 'phone-portrait-outline',
  },
  {
    label: 'Laptops',
    query: 'laptops',
    slugs: ['laptops', 'computers'],
    icon: 'laptop-outline',
  },
  {
    label: 'Gadgets',
    query: 'accessories',
    slugs: ['gadgets', 'accessories'],
    icon: 'game-controller-outline',
  },
  {
    label: 'Audio',
    query: 'headphones',
    slugs: ['audio', 'headphones', 'earbuds'],
    icon: 'headset-outline',
  },
  {
    label: 'Tablets',
    query: 'tablets',
    slugs: ['tablets', 'ipads'],
    icon: 'tablet-portrait-outline',
  },
] as const;

export function HomeCategoryDiscovery() {
  const router = useRouter();
  const { data: catalogCategories = [] } = useCategories();
  const { colors, isDark } = useTheme();
  const accent = isDark ? '#ff858a' : '#b91c1c';

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.text }]}
        >
          Discover devices
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/(tabs)/categories')}
          style={styles.all}
        >
          <Text style={[styles.allLabel, { color: accent }]}>View all</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
      >
        {categories.map(({ label, query, slugs, icon }) => {
          const category = slugs
            .map((slug) => catalogCategories.find((item) => item.slug === slug))
            .find(Boolean);
          const image = category?.image_url;

          return (
            <Pressable
              key={label}
              accessibilityRole="link"
              accessibilityLabel={`Browse ${label.toLowerCase()}`}
              onPress={() =>
                router.push(
                  category
                    ? {
                        pathname: '/category/[slug]',
                        params: { slug: category.slug },
                      }
                    : { pathname: '/search', params: { q: query } }
                )
              }
              style={styles.item}
            >
              <View
                style={[
                  styles.thumbnail,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {image ? (
                  <Image
                    accessible={false}
                    contentFit="contain"
                    source={createSafeBoundedImageSource({
                      uri: image,
                      width: 72,
                      height: 56,
                    })}
                    style={styles.image}
                  />
                ) : (
                  <Ionicons name={icon} size={25} color={accent} />
                )}
              </View>
              <Text style={[styles.label, { color: colors.text }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 12 },
  headingRow: {
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 18, fontWeight: '800' },
  all: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  allLabel: { fontSize: 13, fontWeight: '700' },
  track: { paddingHorizontal: 16, gap: 12 },
  item: { width: 76, gap: 6, alignItems: 'center' },
  thumbnail: {
    width: 72,
    height: 56,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  label: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
