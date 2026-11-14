import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { type Href, Stack, useRouter } from 'expo-router';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SocialLinks } from '@/components/profile/SocialLinks';
import { SUPPORT_WHATSAPP_PHONE } from '@/constants/Support';
import { useMerchant } from '@/hooks/use-merchant';
import { useTheme } from '@/hooks/useTheme';

export function DeviceCareScreen({
  title,
  heading,
  intro,
  sections,
  links = [],
  betweenSections,
  illustration,
  timelineCount = 0,
}: {
  title: string;
  heading: string;
  intro: string;
  sections: readonly { title: string; body: string; icon: IoniconsIconName }[];
  illustration?: number;
  timelineCount?: number;
  betweenSections?: { after: number; label: string; href: Href };
  links?: readonly { label: string; href: Href }[];
}) {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const { data: merchant } = useMerchant();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.page}
    >
      <Stack.Screen options={{ title }} />
      <View style={styles.hero}>
        {illustration ? (
          <Image
            accessible={false}
            source={illustration}
            contentFit="cover"
            style={styles.illustration}
          />
        ) : (
          <Ionicons name="shield-checkmark-outline" size={28} color="#ffc9d1" />
        )}
        <Text accessibilityRole="header" style={styles.heading}>
          {heading}
        </Text>
        <Text style={styles.intro}>{intro}</Text>
      </View>
      {timelineCount > 0 && (
        <Text
          accessibilityRole="header"
          style={[
            styles.heading,
            styles.timelineHeading,
            { color: colors.text },
          ]}
        >
          Three checks before delivery
        </Text>
      )}
      {sections.map((section, index) => (
        <View key={section.title} style={styles.actions}>
          <View
            style={[
              styles.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              pointerEvents="none"
              style={[
                styles.notch,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            />
            <View
              style={[
                styles.icon,
                { backgroundColor: isDark ? '#46232e' : '#fce8ed' },
              ]}
            >
              <Ionicons
                name={section.icon}
                size={22}
                color={isDark ? '#fff' : '#a7182c'}
              />
            </View>
            <View style={styles.sectionCopy}>
              {index < timelineCount && (
                <Text
                  style={[
                    styles.step,
                    { color: isDark ? '#ffb8c6' : '#a7182c' },
                  ]}
                >
                  Check {index + 1} of {timelineCount}
                </Text>
              )}
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.text }]}
              >
                {section.title}
              </Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {section.body}
              </Text>
            </View>
          </View>
          {betweenSections?.after === index && (
            <Pressable
              accessibilityRole="link"
              style={[styles.promo, { borderColor: colors.border }]}
              onPress={() => router.push(betweenSections.href)}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={colors.text}
              />
              <Text style={[styles.title, { color: colors.text, flex: 1 }]}>
                {betweenSections.label}
              </Text>
              <Ionicons name="arrow-forward" size={16} color={colors.text} />
            </Pressable>
          )}
        </View>
      ))}
      <View style={styles.actions}>
        {links.map(({ label, href }) => (
          <Pressable
            key={label}
            accessibilityRole="link"
            style={styles.link}
            onPress={() => router.push(href)}
          >
            <Text style={[styles.title, { color: colors.text }]}>{label}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="link"
          style={styles.link}
          onPress={() =>
            void Linking.openURL(
              `https://wa.me/${SUPPORT_WHATSAPP_PHONE}`
            ).catch(() => router.push('/faq'))
          }
        >
          <Ionicons name="logo-whatsapp" size={20} color={colors.text} />
          <Text style={[styles.title, { color: colors.text }]}>
            WhatsApp support
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          style={styles.link}
          onPress={() =>
            void Linking.openURL('mailto:support@ogabassey.com').catch(() =>
              router.push('/faq')
            )
          }
        >
          <Ionicons name="mail-outline" size={20} color={colors.text} />
          <Text style={[styles.title, { color: colors.text }]}>
            Email support
          </Text>
        </Pressable>
      </View>
      {merchant?.social_media && (
        <SocialLinks socialMedia={merchant.social_media} colors={colors} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 100, gap: 12 },
  hero: { padding: 20, gap: 10, borderRadius: 20, backgroundColor: '#351521' },
  heading: { fontSize: 26, fontWeight: '800', color: '#fff' },
  intro: { fontSize: 16, lineHeight: 23, color: '#f5dce2' },
  illustration: { width: '100%', aspectRatio: 2, borderRadius: 12 },
  timelineHeading: { fontSize: 20, marginTop: 8 },
  step: { fontSize: 12, fontWeight: '700' },
  section: {
    borderRadius: 15,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    flexDirection: 'row',
  },
  sectionCopy: { flex: 1, gap: 5 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notch: {
    position: 'absolute',
    top: -1,
    right: 20,
    height: 6,
    width: 18,
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
    borderBottomWidth: 1,
  },
  title: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
  },
  actions: { gap: 4 },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
