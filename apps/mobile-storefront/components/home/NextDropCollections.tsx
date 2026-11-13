import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';

const collections = [
  {
    title: 'Starter phones',
    slug: 'phones',
    sort: 'price_asc',
    icon: 'phone-portrait-outline',
  },
  {
    title: 'New arrivals',
    slug: 'all',
    sort: 'newest',
    icon: 'sparkles-outline',
  },
] as const;

export function NextDropCollections() {
  const router = useRouter();
  const scheme = useColorScheme();
  const colors = Colors[scheme];
  const iconColor = scheme === 'dark' ? '#ff6970' : BRAND.primary;

  return (
    <View style={styles.row}>
      {collections.map(({ title, slug, sort, icon }) => (
        <Pressable
          key={title}
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: '/category/[slug]',
              params: { slug, sort },
            })
          }
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name={icon} color={iconColor} size={22} />
          <Text style={[styles.label, { color: colors.text }]}>{title}</Text>
          <Ionicons
            name="chevron-forward"
            color={colors.textSecondary}
            size={14}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 12,
    minHeight: 52,
    borderWidth: 1,
  },
  label: { flex: 1, fontWeight: '700', fontSize: 13 },
});
