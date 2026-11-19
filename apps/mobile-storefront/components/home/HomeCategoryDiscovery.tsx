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
  const cardColors = {
    backgroundColor: colors.card,
    borderColor: isDark ? '#a65a68' : '#e89ba7',
  };

  return (
    <View style={styles.section}>
      <ScrollView
        horizontal
        accessibilityLabel="Discover devices"
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
              style={[styles.item, cardColors]}
            >
              <View style={styles.thumbnail}>
                {image ? (
                  <Image
                    accessible={false}
                    contentFit="contain"
                    source={createSafeBoundedImageSource({
                      uri: image,
                      width: 56,
                      height: 56,
                    })}
                    style={styles.image}
                  />
                ) : (
                  <Ionicons
                    name={icon}
                    size={20}
                    color={colors.textSecondary}
                  />
                )}
              </View>
              <Text style={[styles.label, { color: colors.text }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="View all device categories"
          onPress={() => router.push('/(tabs)/categories')}
          style={[styles.item, cardColors]}
        >
          <Ionicons
            name="grid-outline"
            size={20}
            color={colors.textSecondary}
          />
          <Text style={[styles.label, { color: colors.text }]}>View all</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 4 },
  track: { paddingHorizontal: 16, gap: 8 },
  item: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  thumbnail: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  label: { fontSize: 13, fontWeight: '700' },
});
