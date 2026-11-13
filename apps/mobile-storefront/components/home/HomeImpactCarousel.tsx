import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';

const REPORT_URL =
  'https://www.gsma.com/somic/wp-content/uploads/2025/09/The-State-of-Mobile-Internet-Connectivity-2025-Overview-Report.pdf#page=22';

const stories = [
  {
    label: 'Repair Lab',
    title: 'Give your phone more life.',
    body: 'Keep your phone in use for longer.',
    action: 'Explore repairs',
    href: '/repairs' satisfies Href,
    icon: 'construct-outline',
  },
  {
    label: 'Paperless shopping',
    title: 'Keep the receipt. Skip the printout.',
    body: 'Save your digital receipt and use less paper.',
    icon: 'receipt-outline',
  },
  {
    label: 'The digital divide',
    title: 'Getting online starts with access.',
    body: '39% of rural Nigerian adults surveyed owned an internet-enabled phone.',
    source: true,
    icon: 'globe-outline',
  },
] as const;

export function HomeImpactCarousel() {
  const { width } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const cardWidth = Math.min(width - 52, 420);
  const accent = isDark ? '#ff858a' : '#b91c1c';

  return (
    <View style={styles.section}>
      <ScrollView
        horizontal
        accessibilityLabel="Stories about access and sustainability"
        showsHorizontalScrollIndicator
        snapToInterval={cardWidth + 10}
        decelerationRate="fast"
        contentContainerStyle={styles.track}
      >
        <View style={[styles.paycheckCard, { width: cardWidth }]}>
          <Image
            accessible={false}
            source={require('@/assets/images/campaigns/first-paycheck.webp')}
            contentFit="cover"
            contentPosition="top"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.paycheckCopy}>
            <Text style={styles.quote}>
              “I got my first paycheck from my smartphone.”
            </Text>
          </View>
        </View>
        {stories.map((story) => (
          <View
            key={story.title}
            style={[
              styles.card,
              {
                width: cardWidth,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            {'source' in story ? (
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(REPORT_URL).catch(() => {
                    Alert.alert('Could not open the GSMA report');
                  })
                }
                style={styles.action}
              >
                <Text style={{ color: colors.textSecondary }}>
                  GSMA Consumer Survey, 2024 ↗
                </Text>
              </Pressable>
            ) : (
              <View style={styles.labelRow}>
                <Ionicons name={story.icon} size={18} color={accent} />
                <Text style={[styles.label, { color: accent }]}>
                  {story.label}
                </Text>
              </View>
            )}
            <Text style={[styles.title, { color: colors.text }]}>
              {story.title}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {story.body}
            </Text>
            {'href' in story && (
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push(story.href)}
                style={styles.action}
              >
                <Text style={[styles.label, { color: accent }]}>
                  {story.action} →
                </Text>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 4, marginBottom: 4 },
  track: { paddingHorizontal: 16, paddingBottom: 3, gap: 10 },
  card: { borderWidth: 1, borderRadius: 16, padding: 10, gap: 3 },
  paycheckCard: {
    minHeight: 124,
    justifyContent: 'center',
    backgroundColor: '#210b15',
    borderColor: '#512331',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  paycheckCopy: { width: '57%', padding: 12, gap: 4 },
  quote: { color: '#fff', fontSize: 19, lineHeight: 22, fontWeight: '800' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 13, lineHeight: 17 },
  action: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});
